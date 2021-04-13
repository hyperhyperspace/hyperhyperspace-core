import { Store } from 'storage/store';
import { MultiMap } from 'util/multimap';
import { Hash } from '../model/Hashing';
import { BFSHistoryWalk } from './BFSHistoryWalk';
import { CausalHistoryWalk } from './CausalHistoryWalk';
import { OpCausalHistory } from './OpCausalHistory';


// A CasualHistoryFragment is built from a (sub)set of operations
// for a given MutableObject target, that are stored in the "contents"
// (Hash -> OpCausalHistory) map.

// Since during sync the ops themselves are not available, a supplemental
// OpCausalHistory object is used. It only contains the hash of the op,
// the hash of the OpCausalHistory objects of its predecessors, and some
// extra information.

// All history manipulation is done over OpCausalHistory objects, the actual
// op hashes can be obtained once the causality has been sorted out.

// The fragment keeps track of the set of terminal ops (ops without any
// following ops, in the sense that they are the last ops to have been
// applied according to te causal ordering defined by the "prevOps" field).

// It also keeps track of the ops that are referenced by the ops in the 
// fragment but are not in it (in the "missingPrevOpHistories" field).

// Therefore the fragment may be seen as a set of ops that takes the target
// MutableObject from a state that contains all the ops in "missingPrevOpHistories" to a
// state that contains all the ops in "terminalOpHistories".

// lemma: if an op is new to the fragment, then it either
//
//        a) is in the missingOps set.
//
//                     or
//
//        b) is not a direct dependency of any ops in the fragment
//           and therefore it should go into terminalOps.

// proof: assume neither a) or b) hold, then you have a
//        new op that is not in missingOps, but is a
//        direct dependency of an op present in the fragment.
//        But then, since it is a direct dependency and it is not in
//        missingOps, it must be present in the fragment, contrary
//        to our assumption.


class CausalHistoryFragment {

    mutableObj: Hash;

    terminalOpHistories    : Set<Hash>;
    missingPrevOpHistories : Set<Hash>;

    contents : Map<Hash, OpCausalHistory>;

    roots : Set<Hash>;
    
    opHistoriesForOp: MultiMap<Hash, Hash>;

    nextOpHistories : MultiMap<Hash, Hash>;

    constructor(target: Hash) {
        this.mutableObj = target;
        this.terminalOpHistories = new Set();
        this.missingPrevOpHistories  = new Set();

        this.contents = new Map();

        this.roots = new Set();

        this.opHistoriesForOp = new MultiMap();

        this.nextOpHistories = new MultiMap();
    }

    add(opHistory: OpCausalHistory) {

        if (this.isNew(opHistory.causalHistoryHash)) {
            
            this.contents.set(opHistory.causalHistoryHash, opHistory);
            this.opHistoriesForOp.add(opHistory.opHash, opHistory.causalHistoryHash)

            if (opHistory.prevOpHistories.size === 0) {
                this.roots.add(opHistory.causalHistoryHash);
            }

            // Adjust missingOps and terminalOps (see lemma above)
            if (this.missingPrevOpHistories.has(opHistory.causalHistoryHash)) {
                this.missingPrevOpHistories.delete(opHistory.causalHistoryHash);
            } else {
                this.terminalOpHistories.add(opHistory.causalHistoryHash);
            }
            
            for (const prevOpHistory of opHistory.prevOpHistories) {

                // Adjust missingOps and terminalOps with info about this new prev op
                if (this.isNew(prevOpHistory)) {
                    // It may or may not be in missingOps but, since prevOp 
                    // is new, in any case add:
                    this.missingPrevOpHistories.add(prevOpHistory);
                } else {
                    // It may or may not be in terminalOps but, since prevOp 
                    // is not new, in any case remove:
                    this.terminalOpHistories.delete(prevOpHistory);

                }

                // Add reverse mapping to nextOps
                this.nextOpHistories.add(prevOpHistory, opHistory.causalHistoryHash)
            }
        }
    }

    verifyUniqueOps(): boolean {

        for (const opHashes of this.opHistoriesForOp.values()) {
            if (opHashes.size > 1) {
                return false;
            }
        }

        return true;
    }

    remove(opHistoryHash: Hash) {

        const opHistory = this.contents.get(opHistoryHash);

        if (opHistory !== undefined) {

            this.contents.delete(opHistory.causalHistoryHash);
            this.terminalOpHistories.delete(opHistory.causalHistoryHash);

            if (opHistory.prevOpHistories.size === 0) {
                this.roots.delete(opHistory.causalHistoryHash);
            }

            for (const prevOpHistoryHash of opHistory.prevOpHistories) {
                this.nextOpHistories.delete(prevOpHistoryHash, opHistory.causalHistoryHash);

                if (this.nextOpHistories.get(prevOpHistoryHash).size === 0) {
                    if (this.contents.has(prevOpHistoryHash)) {
                        this.terminalOpHistories.add(prevOpHistoryHash)
                    } else {
                        this.missingPrevOpHistories.delete(prevOpHistoryHash);
                    }
                }
            }
        }

    }

    clone(): CausalHistoryFragment {
        const clone = new CausalHistoryFragment(this.mutableObj);

        for (const opHistory of this.contents.values()) {
            clone.add(opHistory);
        } 

        return clone;
    }

    filterByTerminalOpHistories(terminalOpHistories: Set<Hash>): CausalHistoryFragment {

        const filteredOpHistories = this.closureFrom(terminalOpHistories, 'backward');
        const filtered = new CausalHistoryFragment(this.mutableObj);

        for (const hash of filteredOpHistories.values()) {
            filtered.add(this.contents.get(hash) as OpCausalHistory);
        }

        return filtered;
    }

    computeProps(missingOpHistories: Map<Hash, Hash|OpCausalHistory>): void {

        const done = new Set<Hash>();
        const computing = new Set<Hash>();

        for (const hash of this.terminalOpHistories) {
            computing.add(hash);
        }

        while (computing.size > 0) {

            const currentHistoryHash = computing.values().next().value as Hash;

            computing.delete(currentHistoryHash);

            const currentHistory = this.contents.get(currentHistoryHash) as OpCausalHistory;

            const prevOpHistories = new Map<Hash, Hash|OpCausalHistory>();

            for (const prevHistoryHash of currentHistory.prevOpHistories) {

                const missing = missingOpHistories.get(prevHistoryHash);
                if (missing !== undefined) {
                    prevOpHistories.set(prevHistoryHash, missing);
                } else {
                    const history = this.contents.get(prevHistoryHash);

                    if (history === undefined) {
                        throw new Error('Missing prevOp history: cannot compute props');
                    }

                    prevOpHistories.set(prevHistoryHash, history);

                    if (!done.has(prevHistoryHash)) {
                        computing.add(prevHistoryHash);
                    }
                }
            }

            const computed = OpCausalHistory.computeProps(prevOpHistories);

            if (computed !== undefined) {
                if (currentHistory._computedProps === undefined) {
                    currentHistory._computedProps = computed;
                }
            }
            
            done.add(currentHistoryHash)
            computing.delete(currentHistoryHash);
        }

    }

    getStartingOpHistories(): Set<Hash> {
        const startingOpHistories = new Set<Hash>();

        for (const root of this.roots) {
            startingOpHistories.add(root);
        }

        for (const missing of this.missingPrevOpHistories) {
            for (const starting of this.nextOpHistories.get(missing)) {
                startingOpHistories.add(starting);
            }
        }

        return startingOpHistories;
    }

    getTerminalOps(): Set<Hash> {
        return this.getOpsForHistories(this.terminalOpHistories);
    }

    getStartingOps(): Set<Hash> {
        return this.getOpsForHistories(this.getStartingOpHistories());
    }

    getOpHistoryForOp(opHash: Hash): OpCausalHistory | undefined {

        let opHistories = this.opHistoriesForOp.get(opHash);

        if (opHistories === undefined) {
            return undefined;
        } else {
            if (opHistories.size > 1) {
                throw new Error('Op histories matching op ' + opHash + ' were requested from fragment, but there is more than one (' + opHistories.size + ')');                
            } else {
                return this.contents.get(opHistories.values().next().value);
            }
        }
 
    }

    // The following 3 functions operate on the known part of the fragment (what's
    // in this.contents, not the hashes in missingOpHistories).

    // Returns an iterator that visits all opHistories reachable from the initial set.
    
    // - If method is 'bfs', each op history is visited once, in BFS order.
    // - If method is 'causal', each op history is visited as many tomes as there is
    //   a causality relation leading to it (in the provided direction).

    iterateFrom(initial: Set<Hash>|Hash, direction:'forward'|'backward'='forward', method: 'bfs'|'causal'='bfs'): BFSHistoryWalk {
        
        if (!(initial instanceof Set)) {
            initial = new Set([initial]);
        }
        
        if (method === 'bfs') {
            return new BFSHistoryWalk(direction, initial, this);
        } else {
            return new CausalHistoryWalk(direction, initial, this);
        }
        
    }

    // Returns the set of terminal opHistories reachable from initial.

    terminalOpsFor(originOpHistories: Set<Hash>|Hash, direction:'forward'|'backward'='forward'): Set<OpCausalHistory> {
        
        if (!(originOpHistories instanceof Set)) {
            originOpHistories = new Set([originOpHistories]);
        }

        const terminal = new Set<OpCausalHistory>();

        for (const opHistory of this.iterateFrom(originOpHistories, direction, 'bfs')) {
        
            let isTerminal: boolean;

            if (direction === 'forward') {
                isTerminal = this.nextOpHistories.get(opHistory.causalHistoryHash).size === 0;
            } else if (direction === 'backward') {
                
                isTerminal = true;
                for (const prevOpHistory of opHistory.prevOpHistories) {
                    if (!this.missingPrevOpHistories.has(prevOpHistory)) {
                        isTerminal = false;
                        break;
                    }
                }
            } else {
                throw new Error("Direction should be 'forward' or 'backward'.")
            }

            if (isTerminal) {
                terminal.add(opHistory);
            }
        }

        return terminal;
    }

    // Returns true if ALL the hashes in destination are reachable from origin.

    isReachable(originOpHistories: Set<Hash>, destinationOpHistories: Set<Hash>, direction: 'forward'|'backward'): boolean {
        
        const targets = new Set<Hash>(destinationOpHistories.values());

        for (const opHistory of this.iterateFrom(originOpHistories, direction, 'bfs')) {
            targets.delete(opHistory.causalHistoryHash);

            if (targets.size === 0) {
                break;
            }
        }

        return targets.size === 0;
    }

    closureFrom(originOpHistories: Set<Hash>, direction: 'forward'|'backward'): Set<Hash> {
        const result = new Set<Hash>();

        for (const opHistory of this.iterateFrom(originOpHistories, direction, 'bfs')) {
            result.add(opHistory.causalHistoryHash);
        }

        return result;
    }

    causalClosureFrom(startingOpHistories: Set<Hash>, providedOpHistories: Set<Hash>, maxOps?: number, ignoreOpHistory?: (h: Hash) => boolean, filterOpHistory?: (h: Hash) => boolean): Hash[] {

        // We iterate over all the depenency "arcs", each time recording that one dependency has been
        // fullfilled by removing it from a set in missingOpHistories. If the set ever empties, this
        // op can be iterated over (all its prevOps have already been visited). 

        const closure = new Set<Hash>();
        const missingPrevOpHistories = new Map<Hash, Set<Hash>>();
        const result = new Array<Hash>();


        // Create the initial entries in missingPrevOpHistories, not considering anyPrevOps in 
        // providedOpHistories.

        /*
        for (const startingHash of startingOpHistories) {
            if (filterOpHistory === undefined || filterOpHistory(startingHash)) {
                const startingOpHistory = this.contents.get(startingHash) as OpCausalHistory;
                CausalHistoryFragment.loadMissingPrevOpHistories(missingPrevOpHistories, startingOpHistory, providedOpHistories);    
            }
        }
        */

        for (const opHistory of this.iterateFrom(startingOpHistories, 'forward', 'causal')) {
            
            if (maxOps !== undefined && maxOps === result.length) {
                break;
            }

            const hash = opHistory.causalHistoryHash;

            if ((filterOpHistory === undefined || filterOpHistory(hash))) {

                CausalHistoryFragment.loadMissingPrevOpHistories(missingPrevOpHistories, opHistory, providedOpHistories);

                if (missingPrevOpHistories.get(hash)?.size === 0) {

                    for (const nextHash of this.nextOpHistories.get(hash)) {
                        const nextOpHistory = this.contents.get(nextHash) as OpCausalHistory;
                        if (filterOpHistory === undefined || filterOpHistory(nextHash)) {
                            CausalHistoryFragment.loadMissingPrevOpHistories(missingPrevOpHistories, nextOpHistory, providedOpHistories);
                            missingPrevOpHistories.get(nextHash)?.delete(hash); 
                        }
                    }
    
                    if (!closure.has(hash)) {
                        closure.add(hash);
    
                        if (ignoreOpHistory === undefined || !ignoreOpHistory(hash)) {
                            result.push(hash);
                        }    
                    }
                }
                
            }

        }

        return result;

    }

    causalClosure(providedOpHistories: Set<Hash>, maxOps?: number, ignoreOpHistory?: (h: Hash) => boolean, filterOpHistory?: (h: Hash) => boolean) {
        
        return this.causalClosureFrom(this.getStartingOpHistories(), providedOpHistories, maxOps, ignoreOpHistory, filterOpHistory);
    }

    async loadFromTerminalOpHistories(store: Store, terminalOpHistories: Set<Hash>, maxOpHistories?: number, forbiddenOpHistories?: Set<Hash>) {

        let next = new Array<Hash>();

        for (const opHistoryHash of terminalOpHistories) {
            if (forbiddenOpHistories === undefined || !forbiddenOpHistories.has(opHistoryHash)) {

                next.push(opHistoryHash);
            }
        }


        do {
            for (const opHistoryHash of next) {

                const opHistory = await store.loadOpCausalHistoryByHash(opHistoryHash) as OpCausalHistory;

                this.add(opHistory);                

                if (maxOpHistories === this.contents.size) {
                    break;
                }    
            }

            next = [];

            for (const opHistoryHash of this.missingPrevOpHistories) {
                if (forbiddenOpHistories === undefined || !forbiddenOpHistories.has(opHistoryHash)) {
                    next.push(opHistoryHash);
                }
            }

        } while (next.length > 0 && !(this.contents.size === maxOpHistories))
    }

    private static loadMissingPrevOpHistories(missingPrevOpHistories: Map<Hash, Set<Hash>>, opHistory: OpCausalHistory, providedOpHistories: Set<Hash>) {
        let missing = missingPrevOpHistories.get(opHistory.causalHistoryHash);
        if (missing === undefined) {
            missing = new Set<Hash>();

            for (const prevOp of opHistory.prevOpHistories) {
                if (!providedOpHistories.has(prevOp)) {
                    missing.add(prevOp);
                }
            }
            
            missingPrevOpHistories.set(opHistory.causalHistoryHash, missing);
        }

    }

    private isNew(historyHash: Hash) {
        return !this.contents.has(historyHash);
    }

    private getOpsForHistories(histories: Set<Hash>): Set<Hash> {
        return new Set(Array.from(histories).map((history: Hash) => this.contents.get(history)?.opHash)) as Set<Hash>;
    }
}

export { CausalHistoryFragment };