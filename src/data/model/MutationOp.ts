import { HashedObject } from './HashedObject';
import { MutableObject } from './MutableObject';
import { HashedSet } from './HashedSet';

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
}

export { MutationOp }