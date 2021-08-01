import { MutationOp } from './MutationOp';
import { Context } from './Context';
import { Hash } from './Hashing';
import { HashedObject } from './HashedObject';
import { InvalidateAfterOp } from './InvalidateAfterOp';
import { HashReference } from './HashReference';
import { RedoOp } from './RedoOp';

 /*                             causal
  *     InvAfterOp    Op1 <------------------ Op2
  *         ^    \     ^                       ^
  *  target |   c.\    | target                | target
  *         |      \   |        causal         | 
  *       UndoOp    UndoOp(1) <-------------- UndoOp(2)
  *         ^    \     ^                       ^
  *  target |   c.\    | target                | target
  *         |      \   |        causal         |
  *       RedoOp     RedoOp <---------------- RedoOp
  *         ^    \     ^                       ^
  *  target |   c.\    | target                | target
  *         |      \   |        causal         |
  *       UndoOp    UndoOp(3) <-------------- UndoOp(4)
  * 
  */

  /* The diagram above shows the situations where an UndoOp may be necessary. Here
   * InvAfterOp on the top left is invalidating Op1, and transitively Op2 that is
   * causally dependant on Op1. However, InvAfterOp is itself being undone, then
   * redone, then undone again, and those actions are also cascaded to Op1 and Op2.
   * 
   * There are 4 possible cases, marked above:
   * 
   *  (1) is the direct case, where Op1 is being undone because it is outside of the
   *  terminalOps defined in InvAfterOp.
   * 
   *  (2) is a cascade of (1) to Op2, that is dependent on Op1.
   * 
   *  (3) is a cascade of a RedoOp on the original InvAfterOp, that triggers a new
   *  undo for Op1. Notice in this case that the RedoOp is cascaded as an undo.
   * 
   *  (4) is similar to (2), but is undoing a RedoOp for Op2 instead of Op2 itself.
   * 
   * It is important to notice that in all cases but (1),
   * 
   *          undo.causal.target \in undo.target.causalOps
   * 
   */

class UndoOp extends MutationOp {

    static className = 'hhs/v0/UndoOp';

    targetOp?: MutationOp; // the op that will be undone

    constructor(targetOp?: MutationOp, causalOp?: InvalidateAfterOp|UndoOp|RedoOp) {
        super(targetOp?.targetObject, causalOp === undefined? undefined : [causalOp].values());

        if (targetOp !== undefined) {
            this.targetOp = targetOp;

            if (targetOp instanceof UndoOp) {
                throw new Error("An undo op can't be undone this way, please see RedoOp.");
            }

            const undoneOp = targetOp;

            if (undoneOp.causalOps === undefined) {
                throw new Error("Can't undo an op that has no causal assumptions.");
            }

            if (causalOp === undefined) {
                throw new Error('Creating an undo op, but no causal op was provided.');
            }

            if (causalOp instanceof InvalidateAfterOp) {
                
                const invAfterOp = causalOp;

                if (!undoneOp.causalOps.has((invAfterOp.targetOp as MutationOp).createReference())) {

                    throw new Error('Creating undo because of an InvalidateAfterOp, but the op being undone does not depend on the invalidated one.');
                }

                // here we could also check that targetOp is really outside of invalidateAfterOp.terminalOps,
                // but that's costly, and constructor checks aim only to aid debugging, so we'll not.

                if (!this.getTargetObject().equals(invAfterOp.getTargetObject())) {
                    throw new Error('Trying to undo an op in a different mutable object than the invalidation op.');
                }


            } else {

                // Must be one of the cases 2-4 mentioned in the note above, hence:
                //   undo.causal.target \in undo.target.causalOps

                if (!undoneOp.causalOps.has((causalOp.targetOp as MutationOp).createReference())) {
                    throw new Error('Attempting to create a cascaded UndoOp, but the received causal op does not trigger a valid cascade for the op being undone.')
                }

                if (causalOp instanceof RedoOp) { 

                    if (! (this.targetOp instanceof RedoOp)) {
                        throw new Error('If the reason for an UndoOp is a RedoOp, its target must be a RedoOp too.');
                    }
    
                } else if (causalOp instanceof UndoOp) {
    
                    const cascadedUndoOp = causalOp as UndoOp;
    
                    const undoneDepOp = cascadedUndoOp.getTargetOp();
        
                    if (!targetOpCausalOps.has(undoneDepOp.createReference())) {
                        throw new Error('Trying to create UndoOp as cascading of another UndoOp, but the latter is not undoing any op the former is a consequence of.');
                    }
    
                } else {
                    throw new Error('Trying to create an UndoOp, but received reason object is neither an instance of InvalidateAfterOp or UndoOp.');
                }

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

        if (this.hasCausalOps()) {
            return false;
        }

        if (this.targetOp === undefined) {
            return false;
        }

        if (!(this.targetOp instanceof MutationOp)) {
            return false;
        }

        if (!this.getTargetObject().equals(this.targetOp.getTargetObject())) {
            return false;
        }

        const targetOpDeps = this.targetOp.causalOps;

        if (targetOpDeps === undefined) {
            return false;
        }

        if (this.reasonOp === undefined) {
            return false;
        }

        if (!(this.reasonOp instanceof HashReference)) {
            return false;
        }

        const reason = references.get(this.reasonOp.hash);

        if (reason instanceof InvalidateAfterOp) {
            
            const invalidateAfterOp = reason as InvalidateAfterOp;

            const invalidatedDepOp = invalidateAfterOp.getTargetOp();

            if (!targetOpDeps.has(invalidatedDepOp.createReference())) {
                return false;
            }

            if (!this.getTargetObject().equals(invalidateAfterOp.getTargetObject())) {
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