import { MutableObject, MutationOp } from "data/model";

class SomethingMutable extends MutableObject {

    _operations: Set<MutationOp>;

    constructor() {
        super([Mutation.className]);
        this._operations = new Set();
    }

    async mutate(_op: MutationOp): Promise<boolean> {
        this._operations.add(_op);

        return true;
    }

    getOperations() : Set<MutationOp>{
        return new Set(this._operations);
    }

    addOperation(payload: string) {
        let op = new Mutation(this);
        op.payload = payload;
    }

}

class Mutation extends MutationOp {
    static className = 'hhs-test/Mutation';

    payload?: string;

    constructor(target?: MutableObject) {
        super(target);
    }

    getClassName() {
        return Mutation.className;
    }
}

export { SomethingMutable }