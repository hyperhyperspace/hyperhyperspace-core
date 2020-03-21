import { Store, IdbBackend } from 'data/storage';
import { HashedObject } from 'data/model';

import { SomethingHashed, createHashedObjects } from './env/SomethingHashed';


describe('Storage', () => {
    test( 'Indexeddb-based save / load cycle', async () => {
        let objects = createHashedObjects();

        let a: SomethingHashed = objects.a;
        let b: SomethingHashed = objects.b;

        let store = new Store(new IdbBackend('test-storage-backend'));

        await store.save(a);

        let a2 = await store.load(a.hash()) as HashedObject;

        expect(a.equals(a2 as HashedObject)).toBeTruthy();

        let hashedThings = await store.loadByClass(SomethingHashed.CLASS_NAME);

        expect(hashedThings.objects[0].hash()).toEqual(b.hash());
        expect(hashedThings.objects[1].hash()).toEqual(a.hash());

    });

    test( 'Indexeddb-based reference-based load hit', async () => {
        let objects = createHashedObjects();

        let a: SomethingHashed = objects.a;
        let b: SomethingHashed = objects.b;

        let store = new Store(new IdbBackend('test-storage-backend'));

        await store.save(a);

        let result = await store.loadByReference(SomethingHashed.CLASS_NAME, 'reference', b.hash());

        let a2 = result.objects[0];

        expect(a.equals(a2 as HashedObject)).toBeTruthy();

        let hashedThings = await store.loadByClass(SomethingHashed.CLASS_NAME);

        expect(hashedThings.objects[0].hash()).toEqual(b.hash());
        expect(hashedThings.objects[1].hash()).toEqual(a.hash());

    });

    test( 'Indexeddb-based reference-based load miss', async () => {
        let objects = createHashedObjects();

        let a: SomethingHashed = objects.a;
        let b: SomethingHashed = objects.b;

        let store = new Store(new IdbBackend('test-storage-backend'));

        await store.save(a);

        let result = await store.loadByReference(SomethingHashed.CLASS_NAME, 'non-existent-path', b.hash());

        expect(result.objects.length).toEqual(0);
    });
});