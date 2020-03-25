import { HashedObject, MutableObject } from "data/model";
import { MutationOp } from 'data/model/MutationOp';


class HasId extends MutableObject {
    constructor() {
        super();
        this.setRandomId();
    }

    mutate(_op: MutationOp) {

    }

    validate(_op: MutationOp) {
        return false;
    }
}

class OverrideIds extends HashedObject {

    one?: HasId;
    two?: HasId;

    constructor(id: string, override: boolean) {
        super();

        this.setId(id);

        this.one = new HasId();
        this.two = new HasId();

        if (override) { this.overrideChildrenId(); }
    }

}

export { OverrideIds }