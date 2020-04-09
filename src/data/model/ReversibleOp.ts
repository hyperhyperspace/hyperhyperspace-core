import { MutationOp } from './MutationOp';
import { HashedSet } from './HashedSet';
import { MutableObject } from './MutableObject';


abstract class ReversibleOp extends MutationOp {
    
    // dependsUpon: if any of this operations is undone, 
    //              undo this op as well.

    dependsUpon?: HashedSet<ReversibleOp>;

    constructor(target?: MutableObject, dependsUpon?: HashedSet<ReversibleOp>) {
        super(target);

        this.dependsUpon = dependsUpon;
    }

    getDependsUpon() : HashedSet<ReversibleOp> {
        return this.dependsUpon as HashedSet<ReversibleOp>;
    }

}

export { ReversibleOp };