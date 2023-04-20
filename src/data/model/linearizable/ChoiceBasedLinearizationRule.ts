import { Hash } from '../hashing';
import { LinearizationOp } from './LinearizationOp';
import { LinearizationRule } from './LinearizationRule';
import { LinearObject } from './LinearObject';


// Note: shouldReplace is expected to be compatible with the order implicit in the prevLinearOp
//       linearization. Let's use a >> b if a "comes after" b in that order.
//
//        Then for all linearization ops a, b:
// 
//                         a >> b => shouldReplace(a, b)

abstract class ChoiceBasedLinearizationRule<L extends LinearizationOp=LinearizationOp> implements LinearizationRule<L> {
    
    target?: LinearObject<L>;

    lastOpCandidates   : Array<L>;
    lastOpCandidateSet : Set<Hash>;

    constructor() {
        this.lastOpCandidates   = []; // ordered by "shouldReplace"
        this.lastOpCandidateSet = new Set(); 
    }

    setTarget(target: LinearObject<L>): void {
        this.target = target;
    }

    private onBecomingEligible(op: L) {

        if (this.target === undefined) {
            throw new Error('Unexpected: onBecomingEligible called, but target is undefined');
        }

        const prevLogEntryOpHash = op.prevLinearOp?.hash;

        // Either there is no prev entry, or the prev entry is in _lastOpCandidates.
        if (prevLogEntryOpHash === undefined || this.lastOpCandidateSet.has(prevLogEntryOpHash)) {
            
            // Hence either this entry, or its final valid successors, must go into _lastOpCandidates.
            // Furthermore, this is the only case where becoming elegible can change the _lastOpCandidates.

            const lostCandidates = new Set<Hash>();
            const newCandidates  = new Set<Hash>();

            // If there is a prev entry, we'll have to remove it from _lastOpCandidates
            if (prevLogEntryOpHash !== undefined) {
                lostCandidates.add(prevLogEntryOpHash);
            }
                
            const toCheck = new Set<L>();
            toCheck.add(op);

            while (toCheck.size > 0) {
                
                let nextLogEntryOp = toCheck.values().next().value as L;
                toCheck.delete(nextLogEntryOp);
                let foundSuccessor = false;

                for (const possibleSuccessorHash of this.target._nextLinearOps.get(nextLogEntryOp.getLastHash())) {
                    if (this.target.isLinearlyValid(possibleSuccessorHash) && this.target._activeCascInvsPerOp.get(possibleSuccessorHash).size === 0) {
                        toCheck.add(this.target._allLinearOps.get(possibleSuccessorHash) as L);
                        foundSuccessor = true;
                    }
                }

                if (!foundSuccessor) {
                    newCandidates.add(nextLogEntryOp.getLastHash());
                } else {
                    lostCandidates.add(nextLogEntryOp.getLastHash()); // If this is not the first while iteration, nextLogEntryOp may not
                }                                                     // be in _lastOpCandidates - but then removing it will have no effect. 
            }

            this.applyChangesToLastOpCandidates(lostCandidates, newCandidates)
        }
    }

    onBecomingIneligible(op: L) {

        // Every log entry that comes after op must be removed from _lastOpCandidates, since they succeed an
        // ineligible op.

        if (this.target === undefined) {
            throw new Error('Unexpected: onBecomingIneligible called, but target is undefined');
        }

        const successorsToRemove = new Set<Hash>();

        let toCheck = new Set<L>();
        toCheck.add(op);

        while (toCheck.size > 0) {

            let nextLogEntryOp = toCheck.values().next().value as L;
            toCheck.delete(nextLogEntryOp);

            if (this.lastOpCandidateSet.has(nextLogEntryOp.getLastHash())) {
                successorsToRemove.add(nextLogEntryOp.getLastHash());
            } else {
                for (const possibleSuccessorHash of this.target._nextLinearOps.get(nextLogEntryOp.getLastHash())) {
                    if (this.target.isLinearlyValid(possibleSuccessorHash) && this.target._activeCascInvsPerOp.get(possibleSuccessorHash).size === 0) {
                        toCheck.add(this.target._allLinearOps.get(possibleSuccessorHash) as L);
                    }
                }
            }
        }

        const prevLogEntryOpHash = op.prevLinearOp?.hash;

        const predecessorToAdd = new Set<Hash>();

        if (successorsToRemove.size > 0 && prevLogEntryOpHash !== undefined) {

            // If op or one of its successors was in _lastOpCandidates and was removed, then we must check
            // whether op.prev has any remaining valid successors in _lastOpCandidates. If it does not, then 
            // we must add it to _lastOpCandidates.

            toCheck = new Set();
            toCheck.add(this.target._allLinearOps.get(prevLogEntryOpHash) as L);

            let found = false;

            while (toCheck.size > 0) {

                let nextLogEntryOp = toCheck.values().next().value as L;
                toCheck.delete(nextLogEntryOp);

                if (this.lastOpCandidateSet.has(nextLogEntryOp.getLastHash())) {
                    found = true;
                    break;
                }

                for (const possibleSuccessorHash of this.target._nextLinearOps.get(nextLogEntryOp.getLastHash())) {
                    if (this.target.isLinearlyValid(possibleSuccessorHash) && this.target._activeCascInvsPerOp.get(possibleSuccessorHash).size === 0) {
                        toCheck.add(this.target._allLinearOps.get(possibleSuccessorHash) as L);
                    }
                }
            }

            if (!found) {
                predecessorToAdd.add(prevLogEntryOpHash);
            }
        }

        this.applyChangesToLastOpCandidates(successorsToRemove, predecessorToAdd);
    }

    private applyChangesToLastOpCandidates(candidatesToRemove: Set<Hash>, candidatesToAdd: Set<Hash>) {

        if (this.target === undefined) {
            throw new Error('Unexpected: applyChangesToLastOpCandidates called, but target is undefined');
        }

        if (candidatesToRemove.size > 0) {

            const remainingLastOpCandidates: Array<L> = [];

            for (const op of this.lastOpCandidates.values()) {
                const h = op.getLastHash();
                if (candidatesToRemove.has(h)) {
                    this.lastOpCandidateSet.delete(h)
                } else {
                    remainingLastOpCandidates.push(op);
                }
            }

            this.lastOpCandidates = remainingLastOpCandidates;
        }

        
        if (candidatesToAdd.size > 0) {

            for (const hash of candidatesToAdd.values()) {
                const op = this.target._allLinearOps.get(hash) as L;

                let i=0;

                while (i<this.lastOpCandidates.length && !this.shouldUseNewLastOp(op, this.lastOpCandidates[i])) {
                    i = i + 1;
                }

                this.lastOpCandidates.splice(i, 0, op);
                this.lastOpCandidateSet.add(hash);
            }
        }

        if (this.lastOpCandidates.length > 0 && this.lastOpCandidates[0].getLastHash() !== this.target._currentLastLinearOp?.getLastHash()) {
            this.target.setCurrentLastLinearOpTo(this.lastOpCandidates[0].getLastHash());
        }
    }

    onLinearValidityChange(opHash: string, valid: boolean): void {

        if (this.target === undefined) {
            throw new Error('Unexpected: onLinearValidityChange called, but target is undefined');
        }

        // If op is causal valid, then this change has an effect on its global validity (causal + linear).
        // Otherwise, it remains globally invalid as it was!

        if (this.target._activeCascInvsPerOp.get(opHash).size === 0) {

            const op = this.target._allLinearOps.get(opHash) as L;

            if (valid) {
                this.onBecomingEligible(op);
            } else {
                this.onBecomingIneligible(op);
            }
        }
    }

    async applyRule(op: L, opIsValid: boolean): Promise<boolean> {

        if (this.target === undefined) {
            throw new Error('Unexpected: applyRule called, but target is undefined');
        }

        if (op instanceof LinearizationOp) {

            // If op is linearly valid, then this change has an effect on its global validity (causal + linear).
            // Otherwise, it remains globally invalid as it was!

            if (this.target.isLinearlyValid(op.getLastHash())) {
                if (opIsValid) {
                    this.onBecomingEligible(op);
                } else {
                    this.onBecomingIneligible(op);
                }

                return true;
            } else {
                return false;
            }
        } else {
            return true;
        }
    }

    abstract shouldUseNewLastOp(newLastOp: L, currentLastOp: L): boolean;
}

export { ChoiceBasedLinearizationRule };