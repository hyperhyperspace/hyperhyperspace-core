import { Hash } from '../hashing';
import { HashedSet, HashReference } from '../immutable';
import { MutationOp } from '../mutable';
import { ForkableObject } from './ForkableObject';

abstract class ForkableOp extends MutationOp {

    //seq?: bigint;
    forkCausalOps?: HashedSet<ForkableOp>;

    constructor(targetObject?: ForkableObject, forkCausalOps?: IterableIterator<ForkableOp>) {
        super(targetObject);

        if (targetObject !== undefined) {

            if (!(targetObject instanceof ForkableObject)) {
                throw new Error('ForkableOp instances are meant to have ForkableObjects as targets');
            }

            /*if (typeof(seq) !== 'bigint') {
                throw new Error('The seq parameter in a ForkableOp is meant to be a bigint (got ' + typeof (seq) + ' instead).');
            }

            this.seq = seq;*/

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