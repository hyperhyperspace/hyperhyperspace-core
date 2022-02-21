import { MutationOp } from '../mutable/MutationOp';
import { CascadedInvalidateOp } from './CascadedInvalidateOp';
import { HashedObject } from '../immutable/HashedObject';
import { HashedSet } from '../immutable/HashedSet';
import { Hash } from '../hashing/Hashing';
import { HashReference } from '../immutable/HashReference';



abstract class InvalidateAfterOp extends MutationOp {

    targetOp?: MutationOp;

    // Meaning: invalidate targetOp after prevOps, i.e. undo any ops that
    // have targetOp in causalOps but are not contained in the set of ops that
    // come up to {prevOps}.

    constructor(targetOp?: MutationOp) {
        super(targetOp?.targetObject);
        
        if (targetOp !== undefined) {
            this.targetOp = targetOp;

            if (targetOp instanceof CascadedInvalidateOp) {
                throw new Error('An InvalidateAfterOp cannot target an undo / redo op directly.');
            }

            if (targetOp instanceof InvalidateAfterOp) {
                throw new Error('An InvalidateAfterOp cannot target another InvalidateAfterOp directly.');
            }
        }

    }

    init(): void {

    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        if (! (await super.validate(references))) {
            return false;
        }

        if (this.targetOp instanceof CascadedInvalidateOp) {
            return false;
        }

        if (this.targetOp instanceof InvalidateAfterOp) {
            return false;
        }

        if (!this.getTargetOp().getTargetObject().equals(this.getTargetObject())) {
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

    getTerminalOps(): HashedSet<HashReference<MutationOp>> {
        
        if (this.prevOps === undefined) {
            throw new Error('Trying to get terminalOps for InvalidateAfterOp ' + this.hash() + ', but prevOps is not present.');
        }

        return this.prevOps;
    }

}


export { InvalidateAfterOp };