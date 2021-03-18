import { MultiMap } from 'util/multimap';
import { Hash } from '../model/Hashing';
import { OpCausalHistory } from './OpCausalHistory';


// A CasualHistoryFragment is built from a (sub)set of operations
// for a given MutableObject target, that are stored in the "contents"
// (Hash -> OpCausalHistory) map.

// The fragment keeps track of the set of terminal ops (ops without any
// following ops, in the sense that they are the last ops to have been
// applied according to te causal ordering defined by the "prevOps" field).

// It also keeps track of the ops that are referenced by the ops in the 
// fragment but are not in it (in the "missingOps" field).

// Therefore the fragment may be seen as a set of ops that takes the target
// MutableObject from a state that contains all the ops in "missingOps" to a
// state that contains all the ops in "terminalOps".

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

    target: Hash;

    terminalOpHistories : Set<Hash>;
    missingOpHistories  : Set<Hash>;

    contents: Map<Hash, OpCausalHistory>;
    
    nextOpHistories : MultiMap<Hash, Hash>;

    constructor(target: Hash) {
        this.target = target;
        this.terminalOpHistories = new Set();
        this.missingOpHistories  = new Set();

        this.contents = new Map();

        this.nextOpHistories = new MultiMap();
    }

    add(opHistory: OpCausalHistory) {

        if (this.isNew(opHistory.causalHistoryHash)) {
            
            this.contents.set(opHistory.causalHistoryHash, opHistory);

            // Adjust missingOps and terminalOps (see lemma above)
            if (this.missingOpHistories.has(opHistory.causalHistoryHash)) {
                this.missingOpHistories.delete(opHistory.causalHistoryHash);
            } else {
                this.terminalOpHistories.add(opHistory.causalHistoryHash);
            }
            
            for (const prevOpHistory of opHistory.prevOpHistories) {

                // Adjust missingOps and terminalOps with info about this new prev op
                if (this.isNew(prevOpHistory)) {
                    // It may or may not be in missingOps but, since prevOp 
                    // is new, in any case add:
                    this.missingOpHistories.add(prevOpHistory);
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

    remove(opHistoryHash: Hash) {

        const opHistory = this.contents.get(opHistoryHash);

        if (opHistory !== undefined) {

            this.contents.delete(opHistory.causalHistoryHash);
            this.terminalOpHistories.delete(opHistory.causalHistoryHash);

            for (const prevOpHistoryHash of opHistory.prevOpHistories) {
                this.nextOpHistories.delete(prevOpHistoryHash, opHistory.causalHistoryHash);

                if (this.nextOpHistories.get(prevOpHistoryHash).size === 0) {
                    if (this.contents.has(prevOpHistoryHash)) {
                        this.terminalOpHistories.add(prevOpHistoryHash)
                    } else {
                        this.missingOpHistories.delete(prevOpHistoryHash);
                    }
                }
            }
        }

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

        for (const missing of this.missingOpHistories) {
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

    private isNew(historyHash: Hash) {
        return !this.contents.has(historyHash);
    }

    private getOpsForHistories(histories: Set<Hash>): Set<Hash> {
        return new Set(Array.from(histories).map((history: Hash) => this.contents.get(history)?.opHash)) as Set<Hash>;
    }
}

export { CausalHistoryFragment };