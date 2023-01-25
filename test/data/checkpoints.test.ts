// import the mutable types
import { MutableReference } from 'data/collections/mutable/MutableReference';
import { MutableSet } from 'data/collections/mutable/MutableSet';
import { MutableArray } from 'data/collections/mutable/MutableArray';

// add a memory store to the test
import { MemoryBackend, RNGImpl, Store } from 'index';
describe('[CHK] Checkpoints', () => {
    it('[CHK01] Exporting and importing MutableReference', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const ref = new MutableReference();
        ref.setStore(store);
        expect(ref.getLastHash()).toBeDefined()
        ref.setValue(1);
        await ref.save();

        expect(ref.getValue()).toBe(1);
        const checkpoint = await ref.saveCheckpoint();
        ref.setValue(2);
        await ref.save();

        ref.restoreCheckpoint(checkpoint);
        await ref.save();

        expect(ref.getValue()).toBe(1);
    });

    it('[CHK02] Exporting and importing MutableSet', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const set = new MutableSet<number>();
        set.setStore(store);
        set.add(1);
        await set.save();
        expect([...set.values()]).toStrictEqual([1]);
        const checkpoint = await set.saveCheckpoint();
        set.add(2);
        await set.save();
        set.restoreCheckpoint(checkpoint);
        await set.save();
        expect([...set.values()]).toStrictEqual([1]);
    });

    it('[CHK03] Exporting and importing MutableArray', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const arr = new MutableArray<number>();
        arr.setStore(store);
        arr.push(1);
        expect([...arr.values()]).toStrictEqual([1]);
        const arrState = arr.exportMutableState();

        // low level test cases for debugging the checkpoint structures
        const arrClone = new MutableArray<number>();
        arrClone.importMutableState(arrState);
        expect([...arrClone._currentInsertOpOrds.entries()]).toStrictEqual([...arr._currentInsertOpOrds.entries()]);
        expect([...arrClone._elements.entries()]).toStrictEqual([...arr._elements.entries()]);
        expect([...arrClone._elementsPerOrdinal.entries()]).toStrictEqual([...arr._elementsPerOrdinal.entries()]);
        expect([...arrClone._ordinalsPerElement.entries()]).toStrictEqual([...arr._ordinalsPerElement.entries()]);
        expect([...arrClone._currentInsertOpRefs.entries()]).toStrictEqual([...arr._currentInsertOpRefs.entries()]);

        const checkpoint = await arr.saveCheckpoint();
        arr.push(2);
        await arr.save();
        await arr.restoreCheckpoint(checkpoint);
        expect([...arr.values()]).toStrictEqual([1]);
    });
    
})