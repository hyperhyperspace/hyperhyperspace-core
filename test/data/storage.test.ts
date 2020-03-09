import { Store, IdbBackend } from 'data/storage';
import { HashedObject } from 'data/model';

import { SomethingHashed } from './env/SomethingHashed';


describe('Storage', () => {
    test( 'Indexeddb-based save / load cycle', async () => {
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

        await store.save(a).then(() => {
            
        });

        let a2 = await store.load(a.hash()) as HashedObject;

        expect(a.equals(a2 as HashedObject)).toBeTruthy();

        let hashedThings = await store.loadByClass(SomethingHashed.CLASS_NAME);

        expect(hashedThings.objects[0].hash()).toEqual(b.hash());
        expect(hashedThings.objects[1].hash()).toEqual(a.hash());

    });
});