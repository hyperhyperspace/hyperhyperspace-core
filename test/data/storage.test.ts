import { Store, IdbBackend } from 'data/storage';
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

describe('Storage', () => {
    test( 'Indexeddb-based save / load cycle', (done) => {
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

        let store = new Store(new IdbBackend('test-storage-backend'));

        store.save(a).then(() => {
            store.load(a.hash()).then((a2 : HashedObject | undefined) => {
                expect(a.equals(a2 as HashedObject)).toBeTruthy();
                done();
            });
        });

        
        
    });
});