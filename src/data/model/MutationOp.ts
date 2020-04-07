import { HashedObject, LiteralContext } from './HashedObject';
import { MutableObject } from './MutableObject';
import { HashedSet } from './HashedSet';
import { Hash } from './Hashing';
import { HashReference } from './HashReference';

class MutationOp extends HashedObject {

    target?  : MutableObject;
    prevOps? : HashedSet<HashReference>;

    constructor(target?: MutableObject) {
        super();
        this.target  = target;
    }

    getTarget() : MutableObject {
        return this.target as MutableObject;
    }

    getPrevOps() : IterableIterator<HashReference> {
        return (this.prevOps as HashedSet<HashReference>).elements();
    }

    setPrevOps(prevOps: IterableIterator<HashReference>) {
        this.prevOps = new HashedSet(prevOps);
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