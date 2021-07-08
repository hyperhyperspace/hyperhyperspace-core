import { HashedObject } from './HashedObject';
import { HashedSet } from './HashedSet';
import { Hash } from './Hashing';
import { HashReference } from './HashReference';
import { MutationOp } from './MutationOp';


class InvalidateAfterOp extends MutationOp {

    static className = 'hhs/v0/InvalidateAfterOp';

    targetOp?: MutationOp;
    lastValidOps?: HashedSet<HashReference<MutationOp>>;

    constructor(targetOp?: MutationOp, after?: IterableIterator<MutationOp>) {
        super(targetOp?.target);
        
        if (targetOp !== undefined) {
            this.targetOp = targetOp;

            if (after === undefined) {
                throw new Error('InvalidateAfterOp cannot be created: "after" parameter is missing.');
            } else {
                this.lastValidOps = new HashedSet(Array.from(after).map((op: MutationOp) => op.createReference()).values());
            }
        }

    }

    init(): void {

    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        if (! (await super.validate(references))) {
            return false;
        }
        
        for (const lastValidOpRef of (this.lastValidOps as HashedSet<HashReference<MutationOp>>).values()) {
            
            const lastValidOp = references.get(lastValidOpRef.hash) as MutationOp;

            if (lastValidOp === undefined) {
                return false;
            }

            if (!lastValidOp.getTarget().equals(this.target)) {
                return false;
            }
            
        }
        
        if (!(this.targetOp as MutationOp).shouldAcceptInvalidateAfterOp(this)) {
            return false;
        }

        return true;
    
    }

    getClassName(): string {
        return InvalidateAfterOp.className;
    }

    getTargetOp(): MutationOp {
        if (this.targetOp === undefined) {
            throw new Error('Tryingto get targetOp for InvalidateAfterOp ' + this.hash() + ', but it is not present.');
        }

        return this.targetOp;
    }

}

HashedObject.registerClass(InvalidateAfterOp.className, InvalidateAfterOp);

export { InvalidateAfterOp };