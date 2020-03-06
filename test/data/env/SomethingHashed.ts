import { HashedObject, HashedSet } from 'data/model';

class SomethingHashed extends HashedObject {
    name?: string;
    amount?: number;
    things?: HashedSet<any>;

    constructor() {
        super();
        this.things = new HashedSet();
    }

    getClass() {
        return 'SomethingHashed';
    }
}

HashedObject.registerClass('SomethingHashed', SomethingHashed);

export { SomethingHashed };