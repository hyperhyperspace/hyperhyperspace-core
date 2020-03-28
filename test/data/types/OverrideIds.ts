import { HashedObject, MutableObject } from "data/model";
import { MutationOp } from 'data/model/MutationOp';


class HasId extends MutableObject {

    subscribeToCurrentState(_callback: (mutable: MutableObject, state: HashedObject) => void): void {
        throw new Error("Method not implemented.");
    }
    unsubscribeFromCurrentState(_callback: (mutable: MutableObject, state: HashedObject) => void): void {
        throw new Error("Method not implemented.");
    }

    currentState(): HashedObject {
        throw new Error("Method not implemented.");
    }

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