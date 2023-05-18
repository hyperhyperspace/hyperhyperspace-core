import { Hash } from '../hashing';
import { HashedSet, HashReference } from '../immutable';
import { ForkableObject } from './ForkableObject';
import { ForkableOp } from './ForkableOp';


abstract class MergeOp extends ForkableOp {

    mergedForkableOps?: HashedSet<HashReference<ForkableOp>>;
    forkPointOp?: HashReference<ForkableOp>;

    constructor(targetObject?: ForkableObject, mergedForkableOps?: IterableIterator<ForkableOp>, forkPointOp?: ForkableOp, forkCausalOps?: IterableIterator<ForkableOp>) {
        super(targetObject, forkCausalOps);

        if (this.targetObject !== undefined) {

            if (mergedForkableOps !== undefined) {
                this.mergedForkableOps = new HashedSet<HashReference<ForkableOp>>();

                for (const forkableOp of mergedForkableOps) {
                    if (!(forkableOp instanceof ForkableOp)) {
                        throw new Error('The mergedForkalbeOps in a ForkableOp need to be instances of ForkableOp as well.');
                    }

                    if (!(forkableOp.getTargetObject().equalsUsingLastHash(this.getTargetObject()))) {
                        throw new Error('The op ' + forkableOp.getLastHash() + ' in mergedForkableOps points to a different targetObject than the op itself.');
                    }

                    this.mergedForkableOps.add(forkableOp.createReference());
                }

                if (this.mergedForkableOps.size() === 0) {
                    this.mergedForkableOps = undefined;
                }
            }

            if (forkPointOp !== undefined) {
                if (!(forkPointOp instanceof ForkableOp)) {
                    throw new Error('The forkPointOp in a ForkableOp need to be instances of ForkableOp as well.');
                }

                if (!(forkPointOp.getTargetObject().equalsUsingLastHash(this.getTargetObject()))) {
                    throw new Error('The forkPointOp (' + forkPointOp.getLastHash() + ') in mergedForkableOps points to a different targetObject than the op itself.');
                }

                this.forkPointOp = forkPointOp.createReference();
            }
        }
    }

    getPrevForkOpRefs(): IterableIterator<HashReference<ForkableOp>> {
        if (this.mergedForkableOps === undefined) {
            return [].values();
        } else {
            return this.mergedForkableOps.values();
        }
    }

    getPrevForkOpHashes(): IterableIterator<Hash> {
        return Array.from(this.getPrevForkOpRefs()).map((ref: HashReference<ForkableOp>) => ref.hash).values();

    }
}

export { MergeOp };