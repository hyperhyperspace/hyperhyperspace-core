import { HashedObject } from './HashedObject';
import { HashedSet } from './HashedSet';
import { Hash } from './Hashing';
import { HashReference } from './HashReference';
import { MutationOp } from './MutationOp';


class InvalidateAfterOp extends MutationOp {

    static className = 'hhs/v0/InvalidateAfterOp';

    targetOp?: MutationOp;
    terminalOps?: HashedSet<HashReference<MutationOp>>;

    // Meaning: invalidate targetOp after terminalOps, i.e. undo any ops that
    // have targetOp as causalOp but are not contained in the set of ops that
    // come up to {terminalOps}.

    constructor(targetOp?: MutationOp, terminalOps?: IterableIterator<MutationOp>) {
        super(targetOp?.targetObject);
        
        if (targetOp !== undefined) {
            this.targetOp = targetOp;

            if (terminalOps === undefined) {
                throw new Error('InvalidateAfterOp cannot be created: "after" parameter is missing.');
            } else {
                this.terminalOps = new HashedSet(Array.from(terminalOps).map((op: MutationOp) => op.createReference()).values());
            }
        }

    }

    init(): void {

    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        if (! (await super.validate(references))) {
            return false;
        }
        
        for (const terminalOpRef of (this.terminalOps as HashedSet<HashReference<MutationOp>>).values()) {
            
            const terminalOp = references.get(terminalOpRef.hash) as MutationOp;

            if (terminalOp === undefined) {
                return false;
            }

            if (!terminalOp.getTargetObject().equals(this.targetObject)) {
                return false;
            }
            
        }
        
        if (!(this.targetOp as MutationOp).shouldAcceptNoMoreConsequencesOp(this)) {
            return false;
        }

        return true;
    
    }

    getClassName(): string {
        return InvalidateAfterOp.className;
    }

    getTargetOp(): MutationOp {
        if (this.targetOp === undefined) {
            throw new Error('Trying to get targetOp for InvalidateAfterOp ' + this.hash() + ', but it is not present.');
        }

        return this.targetOp;
    }

}

HashedObject.registerClass(InvalidateAfterOp.className, InvalidateAfterOp);

export { InvalidateAfterOp };