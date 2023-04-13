import { Hash } from '../hashing';
import { HashedObject, HashedSet, HashReference } from '../immutable';
import { MutationOp } from '../mutable';
import { LinearObject } from './LinearObject';

abstract class LinearizationOp extends MutationOp {

    seq?: bigint;
    prevLinearOp?: HashReference<this>;
    linearCausalOps?: HashedSet<LinearizationOp>;

    gerPrevLinearOpHash(): Hash {
        if (this.prevLinearOp === undefined) {
            throw new Error('LinearObject: prevLinearOp reference is missing, but its hash was requested.');
        }

        return this.prevLinearOp.hash;
    }

    getLinearCausalOps(): HashedSet<LinearizationOp> {
        if (this.linearCausalOps === undefined) {
            throw new Error('LinearObject: linearOpDeps was requested, but it is missing.');
        }

        return this.linearCausalOps;
    }

    getTargetObject(): LinearObject {
        return super.getTargetObject() as LinearObject;
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        
        if (!(await super.validate(references))) {
            return false;
        }

        if (!(typeof(this.seq) === 'bigint')) {
            return false;
        }

        if (this.prevLinearOp === undefined) {
            if (this.seq !== BigInt(0)) {
                return false;
            }
        } else {

            if (this.prevOps === undefined || !this.prevOps.has(this.prevLinearOp)) {
                return false;
            }

            const prev = references.get(this.prevLinearOp.hash);

            if (!(prev instanceof LinearizationOp)) {
                return false;
            }

            if (!prev.getTargetObject().equals(this.getTargetObject())) {
                return false;
            }

            if (this.seq + BigInt(1) !== prev.seq) {
                return false;
            }
        }

        return true;
    }
}

export { LinearizationOp };