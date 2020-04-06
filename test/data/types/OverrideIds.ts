import { HashedObject, MutableObject } from "data/model";
import { MutationOp } from 'data/model/MutationOp';
import { StateCallback } from 'data/model/MutableObject';


class HasId extends MutableObject {

    subscribeToCurrentState(_callback: StateCallback): void {
        throw new Error("Method not implemented.");
    }

    unsubscribeFromCurrentState(_callback: StateCallback): boolean {
        throw new Error("Method not implemented.");
    }

    currentState(): HashedObject {
        throw new Error("Method not implemented.");
    }

    constructor() {
        super();
        this.setRandomId();
    }  

    async loadState() {
        
    }

    async mutate(_op: MutationOp) : Promise<boolean> {
        throw new Error();
    }

    async validate(_op: MutationOp) : Promise<boolean> {
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