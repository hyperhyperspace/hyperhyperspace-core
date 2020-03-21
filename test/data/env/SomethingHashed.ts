import { HashedObject, HashedSet, HashReference } from 'data/model';

class SomethingHashed extends HashedObject {

    static readonly CLASS_NAME = 'SomethingHashed';

    name?: string;
    amount?: number;
    things?: HashedSet<any>;
    reference?: HashReference;

    constructor() {
        super();
        this.things = new HashedSet();
    }

    getClassName() {
        return SomethingHashed.CLASS_NAME;
    }
}

HashedObject.registerClass(SomethingHashed.CLASS_NAME, SomethingHashed);

let createHashedObjects = () => {
    let a = new SomethingHashed();
    let b = new SomethingHashed();

    let name = 'la la la';
    let amount = 199;

    a.name = name;
    a.amount = amount;

    let name2 = 'le le le';
    let amount2 = 3;

    b.name = name2;
    b.amount = amount2;

    a.things?.add(b);

    a.reference = b.createReference();

    return {a: a, b: b};
}

export { SomethingHashed, createHashedObjects };