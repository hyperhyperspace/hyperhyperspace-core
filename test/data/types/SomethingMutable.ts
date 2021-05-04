import { MutableObject, MutationOp, Hash, HashedObject } from 'data/model';

class SomethingMutable extends MutableObject {

    static className = 'hhs-test/SomethingMutable';

    _operations: Map<Hash, SomeMutation>;

    constructor() {
        super([SomeMutation.className]);

        this.setRandomId();

        this._operations = new Map();
    }

    getClassName() {
        return SomethingMutable.className;
    }

    init() {

    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        references;
        return true;
    }

    async mutate(_op: MutationOp): Promise<boolean> {
        this._operations.set(_op.hash(), _op);
        return true;
    }

    getOperations() : Set<MutationOp>{
        return new Set(this._operations.values());
    }

    async testOperation(payload: string) {
        let op = new SomeMutation(this);
        op.payload = payload;
        await this.applyNewOp(op);
    }

}

SomethingMutable.registerClass(SomethingMutable.className, SomethingMutable);

class SomeMutation extends MutationOp {
    static className = 'hhs-test/SomeMutation';

    payload?: string;

    constructor(target?: MutableObject) {
        super(target);
    }

    getClassName() {
        return SomeMutation.className;
    }

    init() {
        
    }
}

SomeMutation.registerClass(SomeMutation.className, SomeMutation);

export { SomethingMutable, SomeMutation }