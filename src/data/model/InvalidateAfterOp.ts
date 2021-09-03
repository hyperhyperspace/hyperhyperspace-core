import { MutationOp } from './MutationOp';
import { CascadedInvalidateOp } from './CascadedInvalidateOp';
import { HashedObject } from './HashedObject';
import { HashedSet } from './HashedSet';
import { Hash } from './Hashing';
import { HashReference } from './HashReference';



abstract class InvalidateAfterOp extends MutationOp {

    targetOp?: MutationOp;
    terminalOps?: HashedSet<HashReference<MutationOp>>;

    // Meaning: invalidate targetOp after terminalOps, i.e. undo any ops that
    // have targetOp in causalOps but are not contained in the set of ops that
    // come up to {terminalOps}.

    constructor(targetOp?: MutationOp, terminalOps?: IterableIterator<MutationOp>, causalOps?: IterableIterator<MutationOp>) {
        super(targetOp?.targetObject, causalOps);
        
        if (targetOp !== undefined) {
            this.targetOp = targetOp;

            if (terminalOps === undefined) {
                throw new Error('InvalidateAfterOp cannot be created: terminalOps parameter is missing.');
            } else {
                this.terminalOps = new HashedSet(Array.from(terminalOps).map((op: MutationOp) => op.createReference()).values());
            }

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
        
        // check that the terminalOps and the InvAfterOp itself all point to the same MutableObject.
        for (const terminalOpRef of (this.terminalOps as HashedSet<HashReference<MutationOp>>).values()) {
            
            const terminalOp = references.get(terminalOpRef.hash) as MutationOp;

            if (terminalOp === undefined) {
                return false;
            }

            if (!terminalOp.getTargetObject().equals(this.targetObject)) {
                return false;
            }
            
        }

        if (this.targetOp instanceof CascadedInvalidateOp) {
            return false;
        }

        if (this.targetOp instanceof InvalidateAfterOp) {
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

    getTerminalOps() {
        if (this.terminalOps === undefined) {
            throw new Error('Trying to get terminalOps for InvalidateAfterOp ' + this.hash() + ', but it is not present.');
        }

        return this.terminalOps;
    }

}


export { InvalidateAfterOp };