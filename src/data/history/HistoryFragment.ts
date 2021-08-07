import { Store } from 'storage/store';
import { MultiMap } from 'util/multimap';
import { Hash } from '../model/Hashing';
import { BFSHistoryWalk } from './BFSHistoryWalk';
import { FullHistoryWalk } from './FullHistoryWalk';
import { OpHeader } from './OpHeader';


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


class HistoryFragment {

    mutableObj: Hash;

    terminalOpHeaders    : Set<Hash>;
    missingPrevOpHeaders : Set<Hash>;

    contents : Map<Hash, OpHeader>;

    roots : Set<Hash>;
    
    opHeadersForOp: MultiMap<Hash, Hash>;

    nextOpHeaders : MultiMap<Hash, Hash>;

    constructor(target: Hash) {
        this.mutableObj = target;
        this.terminalOpHeaders = new Set();
        this.missingPrevOpHeaders  = new Set();

        this.contents = new Map();

        this.roots = new Set();

        this.opHeadersForOp = new MultiMap();

        this.nextOpHeaders = new MultiMap();
    }

    add(opHeader: OpHeader) {

        if (this.isNew(opHeader.headerHash)) {
            
            this.contents.set(opHeader.headerHash, opHeader);
            this.opHeadersForOp.add(opHeader.opHash, opHeader.headerHash)

            if (opHeader.prevOpHeaders.size === 0) {
                this.roots.add(opHeader.headerHash);
            }

            // Adjust missingOps and terminalOps (see lemma above)
            if (this.missingPrevOpHeaders.has(opHeader.headerHash)) {
                this.missingPrevOpHeaders.delete(opHeader.headerHash);
            } else {
                this.terminalOpHeaders.add(opHeader.headerHash);
            }
            
            for (const prevOpHeader of opHeader.prevOpHeaders) {

                // Adjust missingOps and terminalOps with info about this new prev op
                if (this.isNew(prevOpHeader)) {
                    // It may or may not be in missingOps but, since prevOp 
                    // is new, in any case add:
                    this.missingPrevOpHeaders.add(prevOpHeader);
                } else {
                    // It may or may not be in terminalOps but, since prevOp 
                    // is not new, in any case remove:
                    this.terminalOpHeaders.delete(prevOpHeader);

                }

                // Add reverse mapping to nextOps
                this.nextOpHeaders.add(prevOpHeader, opHeader.headerHash)
            }
        }
    }

    remove(opHeaderHash: Hash) {

        const opHeader = this.contents.get(opHeaderHash);

        if (opHeader !== undefined) {

            this.contents.delete(opHeader.headerHash);
            this.opHeadersForOp.delete(opHeader.opHash, opHeader.headerHash);
            this.terminalOpHeaders.delete(opHeader.headerHash);

            if (opHeader.prevOpHeaders.size === 0) {
                this.roots.delete(opHeader.headerHash);
            }

            if (this.nextOpHeaders.get(opHeaderHash).size > 0) {
                this.missingPrevOpHeaders.add(opHeaderHash);
            }

            for (const prevOpHistoryHash of opHeader.prevOpHeaders) {
                this.nextOpHeaders.delete(prevOpHistoryHash, opHeader.headerHash);

                if (this.nextOpHeaders.get(prevOpHistoryHash).size === 0) {
                    if (this.contents.has(prevOpHistoryHash)) {
                        this.terminalOpHeaders.add(prevOpHistoryHash)
                    } else {
                        this.missingPrevOpHeaders.delete(prevOpHistoryHash);
                    }
                }
            }
        }

    }

    verifyUniqueOps(): boolean {

        for (const opHashes of this.opHeadersForOp.values()) {
            if (opHashes.size > 1) {
                return false;
            }
        }

        return true;
    }

    clone(): HistoryFragment {
        const clone = new HistoryFragment(this.mutableObj);

        for (const opHistory of this.contents.values()) {
            clone.add(opHistory);
        } 

        return clone;
    }

    filterByTerminalOpHeaders(terminalOpHeaders: Set<Hash>): HistoryFragment {

        const filteredOpHeaders = this.closureFrom(terminalOpHeaders, 'backward');
        const filtered = new HistoryFragment(this.mutableObj);

        for (const hash of filteredOpHeaders.values()) {
            filtered.add(this.contents.get(hash) as OpHeader);
        }

        return filtered;
    }

    removeNonTerminalOps() {
        const terminal = new Set<Hash>(this.terminalOpHeaders);

        for (const hash of Array.from(this.contents.keys())) {
            if (!terminal.has(hash)) {
                this.remove(hash);
            }
        }
    }

    addAllPredecessors(origin: Hash | Set<Hash>, fragment: HistoryFragment) {
        for (const opHeader of fragment.iterateFrom(origin, 'backward', 'bfs')) {
            this.add(opHeader);
        }
    }

    getStartingOpHeaders(): Set<Hash> {
        const startingOpHeaders = new Set<Hash>();

        for (const root of this.roots) {
            startingOpHeaders.add(root);
        }

        for (const missing of this.missingPrevOpHeaders) {
            for (const starting of this.nextOpHeaders.get(missing)) {
                startingOpHeaders.add(starting);
            }
        }

        return startingOpHeaders;
    }

    getTerminalOps(): Set<Hash> {
        return this.getOpsForHeaders(this.terminalOpHeaders);
    }

    getStartingOps(): Set<Hash> {
        return this.getOpsForHeaders(this.getStartingOpHeaders());
    }

    getOpHeaderForOp(opHash: Hash): OpHeader | undefined {

        let opHistories = this.opHeadersForOp.get(opHash);

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

    getAllOpHeadersForOp(opHash: Hash): Array<OpHeader> {
        const opHistories = (Array.from(this.opHeadersForOp.get(opHash))
                                  .map((hash: Hash) => this.contents.get(hash)));

        return opHistories as Array<OpHeader>;
    }

    // The following 3 functions operate on the known part of the fragment (what's
    // in this.contents, not the hashes in missingOpHistories).

    // Returns an iterator that visits all opHistories reachable from the initial set.
    
    // - If method is 'bfs', each op history is visited once, in BFS order.
    // - If method is 'causal', each op history is visited as many tomes as there is
    //   a causality relation leading to it (in the provided direction).

    iterateFrom(initial: Set<Hash>|Hash, direction:'forward'|'backward'='forward', method: 'bfs'|'full'='bfs', filter?: (opHistory: Hash) => boolean): BFSHistoryWalk {
        
        if (!(initial instanceof Set)) {
            initial = new Set([initial]);
        }
        
        if (method === 'bfs') {
            return new BFSHistoryWalk(direction, initial, this, filter);
        } else {
            return new FullHistoryWalk(direction, initial, this, filter);
        }
        
    }

    // Returns the set of terminal opHistories reachable from initial.

    terminalOpsFor(originOpHeaders: Set<Hash>|Hash, direction:'forward'|'backward'='forward'): Set<OpHeader> {
        
        if (!(originOpHeaders instanceof Set)) {
            originOpHeaders = new Set([originOpHeaders]);
        }

        const terminal = new Set<OpHeader>();

        for (const opHeader of this.iterateFrom(originOpHeaders, direction, 'bfs')) {
        
            let isTerminal: boolean;

            if (direction === 'forward') {
                isTerminal = this.nextOpHeaders.get(opHeader.headerHash).size === 0;
            } else if (direction === 'backward') {
                
                isTerminal = true;
                for (const prevOpHistory of opHeader.prevOpHeaders) {
                    if (!this.missingPrevOpHeaders.has(prevOpHistory)) {
                        isTerminal = false;
                        break;
                    }
                }
            } else {
                throw new Error("Direction should be 'forward' or 'backward'.")
            }

            if (isTerminal) {
                terminal.add(opHeader);
            }
        }

        return terminal;
    }

    // Returns true if ALL the hashes in destination are reachable from origin.

    isReachable(originOpHeaders: Set<Hash>, destinationOpHeaders: Set<Hash>, direction: 'forward'|'backward'): boolean {
        
        const targets = new Set<Hash>(destinationOpHeaders.values());

        for (const opHistory of this.iterateFrom(originOpHeaders, direction, 'bfs')) {
            targets.delete(opHistory.headerHash);

            if (targets.size === 0) {
                break;
            }
        }

        return targets.size === 0;
    }

    closureFrom(originOpHeaders: Set<Hash>, direction: 'forward'|'backward', filter?: (opHeader: Hash) => boolean): Set<Hash> {
        const result = new Set<Hash>();

        for (const opHeader of this.iterateFrom(originOpHeaders, direction, 'bfs', filter)) {
            result.add(opHeader.headerHash);
        }

        return result;
    }

    causalClosureFrom(startingOpHeaders: Set<Hash>, providedOpHeaders: Set<Hash>, maxOps?: number, ignoreOpHeader?: (h: Hash) => boolean, filterOpHeader?: (h: Hash) => boolean): Hash[] {

        // We iterate over all the depenency "arcs", each time recording that one dependency has been
        // fullfilled by removing it from a set in missingOpHistories. If the set ever empties, this
        // op can be iterated over (all its prevOps have already been visited). 

        const closure = new Set<Hash>();
        const missingPrevOpHeaders = new Map<Hash, Set<Hash>>();
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

        for (const opHeader of this.iterateFrom(startingOpHeaders, 'forward', 'full')) {
            
            if (maxOps !== undefined && maxOps === result.length) {
                break;
            }

            const hash = opHeader.headerHash;

            if ((filterOpHeader === undefined || filterOpHeader(hash))) {

                HistoryFragment.loadMissingPrevOpHeaders(missingPrevOpHeaders, opHeader, providedOpHeaders);

                if (missingPrevOpHeaders.get(hash)?.size === 0) {

                    for (const nextHash of this.nextOpHeaders.get(hash)) {
                        const nextOpHeader = this.contents.get(nextHash) as OpHeader;
                        if (filterOpHeader === undefined || filterOpHeader(nextHash)) {
                            HistoryFragment.loadMissingPrevOpHeaders(missingPrevOpHeaders, nextOpHeader, providedOpHeaders);
                            missingPrevOpHeaders.get(nextHash)?.delete(hash); 
                        }
                    }
    
                    if (!closure.has(hash)) {
                        closure.add(hash);
    
                        if (ignoreOpHeader === undefined || !ignoreOpHeader(hash)) {
                            result.push(hash);
                        }    
                    }
                }
                
            }

        }

        return result;

    }

    causalClosure(providedOpHeaders: Set<Hash>, maxOps?: number, ignoreOpHeader?: (h: Hash) => boolean, filterOpHeader?: (h: Hash) => boolean) {
        
        return this.causalClosureFrom(this.getStartingOpHeaders(), providedOpHeaders, maxOps, ignoreOpHeader, filterOpHeader);
    }

    async loadFromTerminalOpHeaders(store: Store, terminalOpHeaders: Set<Hash>, maxOpHeaders?: number, forbiddenOpHeaders?: Set<Hash>) {

        let next = new Array<Hash>();

        for (const opHeaderHash of terminalOpHeaders) {
            if (forbiddenOpHeaders === undefined || !forbiddenOpHeaders.has(opHeaderHash)) {

                next.push(opHeaderHash);
            }
        }


        do {
            for (const opHeaderHash of next) {

                const opHistory = await store.loadOpHeaderByHeaderHash(opHeaderHash) as OpHeader;

                this.add(opHistory);                

                if (maxOpHeaders === this.contents.size) {
                    break;
                }    
            }

            next = [];

            for (const opHeaderHash of this.missingPrevOpHeaders) {
                if (forbiddenOpHeaders === undefined || !forbiddenOpHeaders.has(opHeaderHash)) {
                    next.push(opHeaderHash);
                }
            }

        } while (next.length > 0 && !(this.contents.size === maxOpHeaders))
    }

    private static loadMissingPrevOpHeaders(missingPrevOpHeaders: Map<Hash, Set<Hash>>, opHeader: OpHeader, providedOpHeaders: Set<Hash>) {
        let missing = missingPrevOpHeaders.get(opHeader.headerHash);
        if (missing === undefined) {
            missing = new Set<Hash>();

            for (const prevOp of opHeader.prevOpHeaders) {
                if (!providedOpHeaders.has(prevOp)) {
                    missing.add(prevOp);
                }
            }
            
            missingPrevOpHeaders.set(opHeader.headerHash, missing);
        }

    }

    private isNew(headerHash: Hash) {
        return !this.contents.has(headerHash);
    }

    private getOpsForHeaders(headers: Set<Hash>): Set<Hash> {
        return new Set(Array.from(headers).map((history: Hash) => this.contents.get(history)?.opHash)) as Set<Hash>;
    }
}

export { HistoryFragment };