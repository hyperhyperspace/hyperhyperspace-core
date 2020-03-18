import { HashedObject } from "./HashedObject";
import { ReplicatedObject } from './ReplicatedObject';

class MutationOp extends HashedObject {

    target?: ReplicatedObject;

    constructor(target?: ReplicatedObject) {
        super();
        this.target = target;
    }

    getTarget() : ReplicatedObject {
        return this.target as ReplicatedObject;
    }
}

export { MutationOp }