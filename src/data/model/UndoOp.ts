import { MutationOp } from './MutationOp';
import { Context } from './Context';
import { Hash } from './Hashing';
import { HashedObject } from './HashedObject';
import { InvalidateAfterOp } from './InvalidateAfterOp';
import { HashReference } from './HashReference';
import { RedoOp } from './RedoOp';

class UndoOp extends MutationOp {

    static className = 'hhs/v0/UndoOp';

    targetOp?: MutationOp; // the op that will be undone

    reason?: HashReference<InvalidateAfterOp|UndoOp|RedoOp>;
    // Either targetOp will be invalidated because it is an
    // untimely consequence of an op that was invalidated by an
    // InvalidateAfterOp op, or it is a consequence that an op
    // that was undone by an UndoOp that we are cascading here.

    constructor(targetOp?: MutationOp, reason?: InvalidateAfterOp|UndoOp|RedoOp) {
        super(targetOp?.target);

        if (targetOp !== undefined) {
            this.targetOp = targetOp;

            if (targetOp instanceof UndoOp) {
                throw new Error("An undo op can't be undone this way, please see RedoOp.");
            }

            if (targetOp instanceof RedoOp) {
                throw new Error("An redo op can't be undone this way, please create a new UndoOp instead.");
            }

            const targetOpDeps = this.targetOp.consequenceOf;

            if (targetOpDeps === undefined) {
                throw new Error("Can't undo an op that is not a consequence of any other ones.");
            }

            if (reason === undefined) {
                throw new Error('Creating undo op, but no reason was provided.');
            }

            this.reason = reason.createReference();

            if (reason instanceof InvalidateAfterOp) {
                
                const invalidateAfterOp = reason as InvalidateAfterOp;

                const invalidatedDepOp = invalidateAfterOp.getTarget();

                if (!targetOpDeps.has(invalidatedDepOp.createReference())) {
                    throw new Error('Wrong undo: the target op is not a consequence of the invalidated op.');
                }

                if (!this.getTarget().equals(invalidateAfterOp.getTarget())) {
                    throw new Error('Trying to undo an op in a different mutable object than the invalidation op.');
                }


            } else if (reason instanceof RedoOp) { 

                

            } else if (reason instanceof UndoOp) {

                const cascadedUndoOp = reason as UndoOp;

                const undoneDepOp = cascadedUndoOp.getTargetOp();
    
                if (!targetOpDeps.has(undoneDepOp.createReference())) {
                    throw new Error('Trying to create UndoOp as cascading of another UndoOp, but the latter is not undoing any op the former is a consequence of.');
                }

            } else {
                throw new Error('Trying to create an UndoOp, but received reason object is neither an instance of InvalidateAfterOp or UndoOp.');
            }

        }

    }

    // Obs: The validate() method in an UndoOp can only check if the UndoOp itself is well built. However,
    //      it is important to verify that the undo is consistent with the history already in the store.
    //      There is a special validateUndosInContext method for that (haven't decided where yet). 

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {
    
        if (!(await super.validate(references))) {
            return false;
        }

        if (this.getAuthor() !== undefined) {
            return false;
        }

        if (this.isConsequence()) {
            return false;
        }

        if (this.targetOp === undefined) {
            return false;
        }

        if (!(this.targetOp instanceof MutationOp)) {
            return false;
        }

        if (!this.getTarget().equals(this.targetOp.getTarget())) {
            return false;
        }

        const targetOpDeps = this.targetOp.consequenceOf;

        if (targetOpDeps === undefined) {
            return false;
        }

        if (this.reason === undefined) {
            return false;
        }

        if (!(this.reason instanceof HashReference)) {
            return false;
        }

        const reason = references.get(this.reason.hash);

        if (reason instanceof InvalidateAfterOp) {
            
            const invalidateAfterOp = reason as InvalidateAfterOp;

            const invalidatedDepOp = invalidateAfterOp.getTargetOp();

            if (!targetOpDeps.has(invalidatedDepOp.createReference())) {
                return false;
            }

            if (!this.getTarget().equals(invalidateAfterOp.getTarget())) {
                return false;
            }

        } else if (reason instanceof UndoOp) {
            
            const cascadedUndoOp = reason as UndoOp;

            const undoneDepOp = cascadedUndoOp.getTargetOp();

            if (!targetOpDeps.has(undoneDepOp.createReference())) {
                return false;
            }

        } else {
            return false;
        }

        return true;
    }

    getClassName() {
        return UndoOp.className;
    }

    init() {

    }

    getTargetOp() : MutationOp {
        return this.targetOp as MutationOp;
    }

    literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('undo');

        return super.literalizeInContext(context, path, flags);

    }

}

HashedObject.registerClass(UndoOp.className, UndoOp);

export { UndoOp }