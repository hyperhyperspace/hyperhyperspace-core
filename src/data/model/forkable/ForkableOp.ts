import { Hash } from '../hashing';
import { HashedObject, HashedSet, HashReference } from '../immutable';
import { MutationOp } from '../mutable';
import { ForkableObject } from './ForkableObject';

abstract class ForkableOp extends MutationOp {

    forkCausalOps?: HashedSet<ForkableOp>;

    constructor(targetObject?: ForkableObject, forkCausalOps?: IterableIterator<ForkableOp>) {
        super(targetObject);

        if (targetObject !== undefined) {

            if (!(targetObject instanceof ForkableObject)) {
                throw new Error('ForkableOp instances are meant to have ForkableObjects as targets');
            }

            if (forkCausalOps !== undefined) {
                this.forkCausalOps = new HashedSet<ForkableOp>();

                for (const forkableOp of forkCausalOps) {
                    if (!(forkableOp instanceof ForkableOp)) {
                        throw new Error('The forkCausalOps in a ForkableOp need to be instances of ForkableOp as well.');
                    }

                    this.forkCausalOps.add(forkableOp);
                }

                if (this.forkCausalOps.size() === 0) {
                    this.forkCausalOps = undefined;
                }
            }
        }
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        if (!(await super.validate(references))) {
            return false;
        }

        if (this.forkCausalOps !== undefined) {
            if (!(this.forkCausalOps instanceof HashedSet)) {
                HashedObject.validationLog.warning('ForkableOp ' + this.getLastHash() + ' of class ' + this.getClassName() + ' has a forkableOps that is not an instance of HashedSet as it should.');
                return false;
            }

            for (const forkCausalOp of this.forkCausalOps.values()) {
                if (!(forkCausalOp instanceof ForkableOp)) {
                    HashedObject.validationLog.warning('ForkableOp ' + this.getLastHash() + ' of class ' + this.getClassName() + ' has a forkable op that is not an instance of ForkableOp as it should.');
                }
            }
        }
        
        return true;
    }

    getForkCausalOps(): HashedSet<ForkableOp> {
        if (this.forkCausalOps === undefined) {
            throw new Error('ForkableObject: linearOpDeps was requested, but it is missing.');
        }

        return this.forkCausalOps;
    }

    getTargetObject() : ForkableObject {
        return this.targetObject as ForkableObject;
    }

    abstract getPrevForkOpRefs(): IterableIterator<HashReference<ForkableOp>>;
    abstract getPrevForkOpHashes(): IterableIterator<Hash>;
}

export { ForkableOp };