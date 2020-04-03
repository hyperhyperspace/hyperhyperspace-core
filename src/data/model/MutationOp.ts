import { HashedObject, LiteralContext } from './HashedObject';
import { MutableObject } from './MutableObject';
import { HashedSet } from './HashedSet';
import { Hash } from './Hashing';

class MutationOp extends HashedObject {

    target?  : MutableObject;
    prevOps? : HashedSet<MutationOp>;

    constructor(target?: MutableObject, prevOps?: HashedSet<MutationOp>) {
        super();
        this.target  = target;
        this.prevOps = prevOps;
    }

    getTarget() : MutableObject {
        return this.target as MutableObject;
    }

    getPrevOps() : IterableIterator<MutationOp> {
        return (this.prevOps as HashedSet<MutationOp>).elements();
    }

    literalizeInContext(context: LiteralContext, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('op');

        return super.literalizeInContext(context, path, flags);

    }

}

export { MutationOp }