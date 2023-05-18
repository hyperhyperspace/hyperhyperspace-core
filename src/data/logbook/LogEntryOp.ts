import { ForkableObject, LinearOp } from '../model';
import { Hash, HashedObject, HashedSet, HashReference, MutationOp } from '../model';
import { TransitionOp } from './TransitionOp';
import { TransitionLog } from './TransitionLog';


class LogEntryOp<T extends ForkableObject, I=undefined> extends LinearOp {

    static className = 'hhs/v0/LogEntryOp';

    entryNumber?: bigint;

    transitionOps?: HashedSet<TransitionOp<T>>;
    info?: I;

    _transitionOpsByTarget?: Map<Hash, TransitionOp<T>>;

    getClassName(): string {
        return LogEntryOp.className;
    }

    init(): void {
       
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        if (!(await super.validate(references))) {
            return false;
        }

        if (!(this.transitionOps instanceof HashedSet)) {
            return false;
        }

        for (const transOp of this.transitionOps.values()) {
            if (!(transOp instanceof TransitionOp)) {
                return false;
            }

            // Since we check that transOp is in prevOps, we know that its traget is
            // the same as this.targetObject
            if (!(this.prevOps as HashedSet<HashReference<MutationOp>>).has(transOp.createReference())) {
                return false;
            }

            if (this.prevForkableOp === undefined) {
                if (transOp.prevTransitionOp !== undefined) {
                    LogEntryOp.validationLog.warning('Trying to apply TransitionOp ' + transOp.getLastHash() + ' as part of log entry ' + this.getLastHash() + ', but it refers to a previous state even ')
                    return false;
                }
            } else {
                const prevLogEntryOp = references.get(this.prevForkableOp.hash);

                if (!(prevLogEntryOp instanceof LogEntryOp)) {
                    LogEntryOp.validationLog.warning('The prevLinearOp received as a reference for validating LogEntryOp ' + this.getLastHash() + ' has the wrong type: ' + prevLogEntryOp?.getClassName());
                    return false;
                }

                const prevStateInfo = await this.getTargetObject().getStateInfoAtEntry(transOp.transitionTarget?.getLastHash() as Hash, prevLogEntryOp, references);

                if (prevStateInfo?.stateHash !== transOp.transitionStartOp?.getLastHash()) {
                    LogEntryOp.validationLog.warning('TransitionOp previous state mismatch. Stated: ' + transOp.transitionStartOp?.getLastHash() + ' Actual: ' + prevStateInfo?.stateHash);
                    return false;
                }

                if (prevStateInfo?.logEntryOpHash !== transOp.prevTransitionLogEntryHash) {
                    LogEntryOp.validationLog.warning('TransitionOp previous entry log mismatch. Stated: ' + transOp.prevTransitionLogEntryHash + ' Actual: ' + prevStateInfo?.logEntryOpHash);
                    return false;
                }
            }
        }

        // We know that super.prevLinearOp is in prevOps, and so are all transitionOps.
        // Let's check that there's not anything else in there:

        const prevOpsSize = (this.prevOps as HashedSet<HashReference<MutationOp>>).size();

        if (prevOpsSize !== this.transitionOps.size() + 1) {
            return false;
        }

        return true;
    }

    getTransitionOpsByTarget(): Map<Hash, TransitionOp<T>> {
        if (this._transitionOpsByTarget === undefined) {
            this._transitionOpsByTarget = new Map();

            for (const transOp of (this.transitionOps as HashedSet<TransitionOp<T>>).values()) {
                this._transitionOpsByTarget.set((transOp.transitionTarget as T).getLastHash(), transOp);
            }
        }

        return this._transitionOpsByTarget;
    }

    getTargetObject(): TransitionLog<T> {
        return super.getTargetObject() as TransitionLog<T>;
    }
    
}

export { LogEntryOp };