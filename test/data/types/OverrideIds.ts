import { HashedObject, MutableObject } from "data/model";
import { MutationOp } from 'data/model/MutationOp';


class HasId extends MutableObject {

    constructor() {
        super([]);
        this.setRandomId();
    }  

    getClassName() {
        return 'hhs-test/HasId';
    }

    init() {

    }

    async loadState() {
        
    }

    async mutate(_op: MutationOp) : Promise<boolean> {
        throw new Error();
    }

    async validate(references: Map<string, HashedObject>) : Promise<boolean> {
        references;
        return true;
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

    getClassName() {
        return 'hhs-test/OverrideIds';
    }

    init() {
        
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        references;
        return true;
    }

}

export { OverrideIds }