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

    terminalOps : Set<Hash>;
    missingOps  : Set<Hash>;

    contents: Map<Hash, OpCausalHistory>;
    
    nextOps : MultiMap<Hash, Hash>;

    constructor(target: Hash) {
        this.target = target;
        this.terminalOps = new Set();
        this.missingOps  = new Set();

        this.contents = new Map();

        this.nextOps = new MultiMap();
    }

    add(opHistory: OpCausalHistory) {

        if (this.isNew(opHistory.opHash)) {
            
            this.contents.set(opHistory.opHash, opHistory);

            // Adjust missingOps and terminalOps (see lemma above)
            if (this.missingOps.has(opHistory.opHash)) {
                this.missingOps.delete(opHistory.opHash);
            } else {
                this.terminalOps.add(opHistory.opHash);
            }
            
            for (const prevOpHash of opHistory.prevOpHashes) {

                // Adjust missingOps and terminalOps with info about this new prev op
                if (this.isNew(prevOpHash)) {
                    // It may or may not be in missingOps but, since prevOp 
                    // is new, in any case add:
                    this.missingOps.add(prevOpHash);
                } else {
                    // It may or may not be in terminalOps but, since prevOp 
                    // is not new, in any case remove:
                    this.terminalOps.delete(prevOpHash);

                }

                // Add reverse mapping to nextOps
                this.nextOps.add(prevOpHash, opHistory.opHash)
            }
        }
    }

    remove(opHash: Hash) {

        const opHistory = this.contents.get(opHash);

        if (opHistory !== undefined) {

            this.contents.delete(opHistory.opHash);
            this.terminalOps.delete(opHistory.opHash);

            for (const prevOpHash of opHistory.prevOpHashes) {
                this.nextOps.delete(prevOpHash, opHistory.opHash);

                if (this.nextOps.get(prevOpHash).size === 0) {
                    if (this.contents.has(prevOpHash)) {
                        this.terminalOps.add(prevOpHash)
                    } else {
                        this.missingOps.delete(prevOpHash);
                    }
                }
            }
        }

    }

    checkAndComputeProps(missingOpHistories: Map<Hash, Hash|OpCausalHistory>): boolean {

        const verified = new Set<Hash>();
        const checking = new Set<Hash>();

        for (const hash of this.terminalOps) {
            checking.add(hash);
        }

        while (checking.size > 0) {

            const currentOpHash = checking.values().next().value as Hash;

            checking.delete(currentOpHash);

            const currentOp = this.contents.get(currentOpHash) as OpCausalHistory;

            const prevOpHistories = new Map<Hash, Hash|OpCausalHistory>();

            for (const prevOpHash of currentOp.prevOpHashes) {

                if (prevOpHash === currentOpHash) {
                    return false; // self loop, bail out.
                }

                if (verified.has(prevOpHash)) {
                    return false; // cycle detected, bail out.
                }

                const missing = missingOpHistories.get(prevOpHash);
                if (missing !== undefined) {
                    prevOpHistories.set(prevOpHash, missing);
                } else {
                    const op = this.contents.get(prevOpHash);

                    if (op === undefined) {
                        return false;
                    }

                    prevOpHistories.set(prevOpHash, op);

                    if (!verified.has(prevOpHash)) {
                        checking.add(prevOpHash);
                    }
                }
            }

            if (currentOp.verify(prevOpHistories)) {

                const computed = OpCausalHistory.computeProps(prevOpHistories);

                if (computed !== undefined) {
                    if (currentOp._computedProps === undefined) {
                        currentOp._computedProps = computed;
                    } else {
                        if (currentOp._computedProps.size !== computed.size ||
                            currentOp._computedProps.height !== computed.height) {

                                return false;
                                
                        }
                    }
                }
                

                verified.add(currentOpHash)
                checking.delete(currentOpHash);
            } else {
                return false;
            }
        }

        return true;

    }

    private isNew(opHash: Hash) {
        return !this.contents.has(opHash);
    }
}

export { CausalHistoryFragment };