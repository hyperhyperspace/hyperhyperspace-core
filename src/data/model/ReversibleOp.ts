import { MutationOp } from './MutationOp';
import { HashedSet } from './HashedSet';
import { MutableObject } from './MutableObject';


class ReversibleOp extends MutationOp {
    
    // dependsUpon: if any of this operations is undone, 
    //              undo this op as well.

    dependsUpon?: HashedSet<ReversibleOp>;

    constructor(target?: MutableObject, prevOps?: HashedSet<MutationOp>, dependsUpon?: HashedSet<ReversibleOp>) {
        super(target, prevOps);

        this.dependsUpon = dependsUpon;
    }

    getDependsUpon() : HashedSet<ReversibleOp> {
        return this.dependsUpon as HashedSet<ReversibleOp>;
    }

}

export { ReversibleOp };