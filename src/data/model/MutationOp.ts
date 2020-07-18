import { HashedObject } from './HashedObject';
import { Context } from './Context';  
import { MutableObject } from './MutableObject';
import { HashedSet } from './HashedSet';
import { Hash } from './Hashing';
import { HashReference } from './HashReference';

abstract class MutationOp extends HashedObject {

    target?  : MutableObject;
    prevOps? : HashedSet<HashReference<MutationOp>>;

    constructor(target?: MutableObject) {
        super();
        this.target  = target;
    }

    validate(references: Map<Hash, HashedObject>) {

        if (this.target === undefined) {
            return false;
        }

        if (this.prevOps !== undefined) {
            for (const prevOpRef of this.prevOps.values()) {
                let prevOp = references.get(prevOpRef.hash);

                if (prevOp === undefined) {
                    return false;
                } else if (! (prevOp instanceof MutationOp)) {
                    return false
                } else if (! ((prevOp as MutationOp).target as MutableObject).equals(this.target)) { 
                    return false;
                }
            }
        }

        return true;

    }

    getTarget() : MutableObject {
        return this.target as MutableObject;
    }

    setTarget(target: MutableObject) {
        this.target = target;
    }

    getPrevOps() : IterableIterator<HashReference<MutationOp>> | undefined {
        return this.prevOps?.values();
    }

    setPrevOps(prevOps: IterableIterator<HashReference<MutationOp>>) {
        this.prevOps = new HashedSet(prevOps);
    }

    literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('op');

        return super.literalizeInContext(context, path, flags);

    }

}

export { MutationOp }