import { HashedMap } from './HashedMap';
import { HashedObject } from './HashedObject';
import { HashedSet } from './HashedSet';
import { Hash } from './Hashing';
import { InvalidateAfterOp } from './InvalidateAfterOp';
import { MutationOp } from './MutationOp';

 /*
  *        Op0 <-
  *         ^     \
  *  target |    c.\
  *         |       \            causal
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

 /*
  *         
  *                  causal                      causal
  *        Op0  <--------------------- Op1 <------------------ Op2
  *         ^       _________________/  ^                       ^
  *  target |      / Op1 is too late    | target                | target
  *         |     /                     |        causal         | 
  *     InvAfterOp <---------------  UndoOp(1) <-------------- UndoOp(2)
  *         ^        causal             ^                       ^
  *  target |                           | target                | target
  *         |        causal             |        causal         |
  *       UndoOp <-----------------  RedoOp <---------------- RedoOp
  *         ^                           ^                       ^
  *  target |                           | target                | target
  *         |        causal             |        causal         |
  *       RedoOp <-----------------  UndoOp(3) <-------------- UndoOp(4)
  *         ^                           ^                       ^
  *         |...                        |...                    |...
  * 
  */

 /* 
  * 
  * Always: this.causal.target \in this.target.causal
  * 
  * if causal is InvAfterOp => target is NOT CascadeOp, this.undo = true 
  * if causal is CascadeOp  => target is CascadeOp, this.undo = !this.target.undo
  * 
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

class CascadedInvalidateOp extends MutationOp {

    static className = 'hhs/v0/CascadedInvalidateOp';

    undo?: boolean;
    targetOp?: MutationOp;

    constructor(undo?: boolean, targetOp?: MutationOp, causalOp?: InvalidateAfterOp|CascadedInvalidateOp) {
        super(targetOp?.targetObject);

        if (undo !== undefined) {
            this.undo = undo;

            const opType = undo? 'UndoOp':'RedoOp';

            if (targetOp === undefined) {
                throw new Error('Cannot create ' + opType + ', targetOp not provided.');
            }

            this.targetOp = targetOp;

            if (causalOp === undefined) {
                throw new Error('Cannot create ' + opType + ', causalOp not provided.');
            }

            this.addCausalOp('CascadedInvalidateOp/cause', causalOp);
            
            // this.causalOps is initialized by call to super() above

            // sanity checks:

            // The cascade has merit: causalOp.targetOp \in targetOp.causalOps
            if (!new Set(targetOp.getCausalOps().valueHashes()).has(causalOp.getTargetOp().hash())) {
                throw new Error('Creating undo because of an InvalidateAfterOp, but the op being undone does not depend on the invalidated one.');
            }

            // First CascadedInvOp in a chain is always an UndoOp, after that undos and redos alternate.
            if (targetOp instanceof CascadedInvalidateOp) {
                if (this.undo === targetOp.undo) {
                    throw new Error('Creating ' + opType + ' that has another ' + opType + ' as target, only alternating undo <- redo <- undo ... chains are admissible.');
                }
            } else {
                if (!this.undo) {
                    throw new Error('A RedoOp can only have an UndoOp as target (found a ' + targetOp.getClassName() + ')');
                }
            }

            if (causalOp instanceof InvalidateAfterOp) {
                
                const invAfterOp = causalOp;

                // invAfterOps can only be used as cause for UndoOps
                if (!undo) {
                    throw new Error('Creating a RedoOp using an InvalidateAfterOp as causalOp (this should be an UndoOp then).');
                }

                // here we could also check that targetOp is really outside of invalidateAfterOp.terminalOps,
                // but that's costly, and constructor checks aim only to aid debugging, so we'll not.

                // invAfterOps can only be used as cause for ops within the same MutableObject
                if (!this.getTargetObject().equals(invAfterOp.getTargetObject())) {
                    throw new Error('Trying to undo an op in a different mutable object than the invalidation op.');
                }

                // undo / redo ops cannot be invalidated by a InvAfterOp
                if (targetOp instanceof CascadedInvalidateOp) {
                    throw new Error('Creating an ' + opType + ' with an UndoOp or RedoOp as target, an an InvalidateAfterOp as cause. InvalidateAfterOps only affect regular ops, not undos/redos.');
                }
            } else if (causalOp instanceof CascadedInvalidateOp) {
                // we're covered here
            } else {
                throw new Error('The cause of an undo/redo can only be another UndoOp/RedoOp, or an InvalidateAfterOp.');
            }

            this.prevOps = new HashedSet([/*causalOp.createReference(), */targetOp.createReference()].values());

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
            CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' has an author, it should not.');
            return false;
        }

        if (this.undo === undefined) {
            CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' has no undo field');
            return false;
        }

        if (typeof(this.undo) !== 'boolean') {
            CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' undo field is not boolean');
            return false;
        }

        if (this.targetOp === undefined) {
            CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' targetOp is undefined');
            return false;
        }

        if (!(this.targetOp instanceof MutationOp)) {
            CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' targetOp is not a mutationOp');
            return false;
        }

        if (this.causalOps === undefined) {
            CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' causalOps is undefined');
            return false;
        }

        if (!(this.causalOps instanceof HashedMap)) {
            CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' causalOps is not an instance of HashedMap');
            return false;
        }

        if (this.causalOps?.size() !== 1) {
            CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' causalOps does not have exactly one element');
            return false;
        }

        const causalOp = this.causalOps.get('CascadedInvalidateOp/cause');

        if (causalOp instanceof InvalidateAfterOp) {
            
            const invAfterOp = causalOp;

            // invAfterOps can only be used as cause for UndoOps
            if (!this.undo) {
                CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' is consequence of an InvalidateAfterOp, but it is a redo (only undos make sense in that case)');
                return false;
            }

            // here we could also check that targetOp is really outside of invalidateAfterOp.terminalOps,
            // but that's costly, and constructor checks aim only to aid debugging, so we'll not.

            // invAfterOps can only be used as cause for ops within the same MutableObject
            if (!this.getTargetObject().equals(invAfterOp.getTargetObject())) {
                CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' is caused by an InvalidateAfterOp in another object');
                return false;
            }

            // undo / redo ops cannot be invalidated by a InvAfterOp
            if (this.targetOp instanceof CascadedInvalidateOp) {
                CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' is invalidating another CascadedInvalidateOp, but is caused by an InvalidateAfterOp (hence it is not a cascade!)');
                return false;
            }
        } else if (causalOp instanceof CascadedInvalidateOp) {
            // we're covered here
        } else {
            CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' is not either the consequence of an InvalidateAfterOp or a cascade of another CascadeInvalidateOp, the offending class is ' + causalOp?.getClassName());
            return false;
        }

        // The cascade has merit: causalOp.targetOp \in targetOp.causalOps
        if (!new Set(this.targetOp.getCausalOps().valueHashes()).has(causalOp.getTargetOp().hash())) {
            CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' makes no sense: causalOp.targetOp not in targetOp.causalOps');
            return false;
        }

        // First CascadedInvOp in a chain is always an UndoOp, after that undos and redos alternate.
        if (this.targetOp instanceof CascadedInvalidateOp) {
            if (this.undo === this.targetOp.undo) {
                CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' makes no sense: its undo value is equal to its targetOp undo value (it should be opposite)');
                return false;
            }
        } else {
            if (!this.undo) {
                CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' is consequence of an InvalidateAfterOp, but it is a redo (only undos make sense in that case)');
                return false;
            }
        }

        const prevOps = new HashedSet([/*causalOp.createReference(), */this.targetOp.createReference()].values());

        // see that prevOps are correctly generated
        if (this.prevOps === undefined || !this.prevOps.equals(prevOps)) {
            CascadedInvalidateOp.validationLog.debug('CascadedInvalidateOp ' + this.hash() + ' prevOps contents is wrong (should be just the targetOp)');
            return false;
        }

        return true;
    }

    getTargetOp(): MutationOp {
        if (this.targetOp === undefined) {
            throw new Error('Trying to get targetOp for InvalidateAfterOp ' + this.hash() + ', but it is not present.');
        }

        return this.targetOp;
    }

    getFinalTargetOp(): MutationOp {

        let finalTargetOp = this.getTargetOp();

        while (finalTargetOp instanceof CascadedInvalidateOp) {
            finalTargetOp = finalTargetOp.getTargetOp();
        }

        return finalTargetOp;

    }

    /*literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        if (this.undo) {
            flags.push('undo');
        } else {
            flags.push('redo');
        }
        

        return super.literalizeInContext(context, path, flags);

    }*/

    getClassName(): string {
        return CascadedInvalidateOp.className;
    }

    init(): void {
        
    }

    static create(targetOp: MutationOp, causalOp: InvalidateAfterOp|CascadedInvalidateOp) {
        
        const undo = (targetOp instanceof CascadedInvalidateOp)? !targetOp.undo : true;

        if (undo) {
            return new CascadedInvalidateOp(true, targetOp, causalOp);
        } else {
            return new CascadedInvalidateOp(false, targetOp, causalOp);
        }
    }

}

HashedObject.registerClass(CascadedInvalidateOp.className, CascadedInvalidateOp);

export { CascadedInvalidateOp };