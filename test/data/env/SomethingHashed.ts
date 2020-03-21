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

    getClass() {
        return SomethingHashed.CLASS_NAME;
    }
}

HashedObject.registerClass(SomethingHashed.CLASS_NAME, SomethingHashed);

export { SomethingHashed };