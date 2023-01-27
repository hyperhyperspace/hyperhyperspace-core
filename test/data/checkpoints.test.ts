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
        ref.setValue(1);
        await ref.save();

        expect(ref.getValue()).toBe(1);
        const checkpoint = await ref.saveCheckpoint();
        ref.setValue(2);
        await ref.save();

        await ref.restoreCheckpoint(checkpoint);
        //await ref.save();

        expect(ref.getValue()).toBe(1);
    });
    
    it('[CHK02] Exporting and importing MutableReference to a HashedObject', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const ref = new MutableReference();
        const innerRef = new MutableReference();
        ref.setStore(store);
        innerRef.setStore(store);
        ref.setValue(innerRef);
        await ref.save();

        expect(ref.getValue()).toBeInstanceOf(MutableReference);
        const checkpoint = await ref.saveCheckpoint();
        
        ref.setValue(2);
        await ref.save();

        await ref.restoreCheckpoint(checkpoint);
        //await ref.save();

        expect(ref.getValue()).toBeInstanceOf(MutableReference);
        expect((ref.getValue() as MutableReference<any>).hash).toEqual(innerRef.hash);
    });

    it('[CHK03] Exporting and importing MutableSet', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const set = new MutableSet<number>();
        set.setStore(store);
        set.add(1);
        await set.save();
        expect([...set.values()]).toStrictEqual([1]);
        const checkpoint = await set.saveCheckpoint();
        set.add(2);
        await set.save();
        await set.restoreCheckpoint(checkpoint);
        expect([...set.values()]).toStrictEqual([1]);
    });
    
    it('[CHK04] Exporting and importing MutableSet with HashedObject members', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const set = new MutableSet<MutableReference<number>>();
        set.setStore(store);
        const innerRef = new MutableReference<number>();
        innerRef.setStore(store);
        innerRef.setValue(1);
        await innerRef.save();
        set.add(innerRef);
        await set.save();
        expect([...set.values()]).toStrictEqual([innerRef]);
        const checkpoint = await set.saveCheckpoint();
        set.add(new MutableReference<number>());
        await set.save();
        await set.restoreCheckpoint(checkpoint);

        expect([...[...set.values()].map(x => x.hash())]).toStrictEqual([innerRef.hash()]);
        
        

        // load each element in the set
        for (const ref of set.values()) {
            ref.setStore(store);
            await ref.loadAllChanges();
        }
        // check equality of inner values
        expect([...[...set.values()].map(x => x.getValue())]).toStrictEqual([innerRef.getValue()]);
    });

    it('[CHK05] Exporting and importing MutableArray', async () => {
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
    
    it('[CHK06] Exporting and importing MutableArray with HashedObject members', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const arr = new MutableArray<MutableReference<number>>();
        arr.setStore(store);
        const innerRef = new MutableReference<number>();
        innerRef.setStore(store);
        innerRef.setValue(1);
        await innerRef.save();
        arr.push(innerRef);
        await arr.save();
        expect([...arr.values()]).toStrictEqual([innerRef]);
        const checkpoint = await arr.saveCheckpoint();
        arr.push(new MutableReference<number>());
        await arr.save();
        await arr.restoreCheckpoint(checkpoint);
        //await arr.save();

        expect([...[...arr.values()].map(x => x.hash())]).toStrictEqual([innerRef.hash()]);

        // load each element in the array
        for (const ref of arr.values()) {
            await ref.loadAllChanges();
        }
        // check equality of inner values
        expect([...[...arr.values()].map(x => x.getValue())]).toStrictEqual([innerRef.getValue()]);
    });
    
    it('[CHK07] Exporting and importing GrowOnlySet', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const set = new MutableSet<number>();
        set.setStore(store);
        set.add(1);
        await set.save();
        expect([...set.values()]).toStrictEqual([1]);
        const checkpoint = await set.saveCheckpoint();
        set.add(2);
        await set.save();
        await set.restoreCheckpoint(checkpoint);
        expect([...set.values()]).toStrictEqual([1]);
    });
    
    it('[CHK08] Exporting and importing GrowOnlySet with HashedObject members', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const set = new MutableSet<MutableReference<number>>();
        set.setStore(store);
        const innerRef = new MutableReference<number>();
        innerRef.setStore(store);
        innerRef.setValue(1);
        await innerRef.save();
        set.add(innerRef);
        await set.save();
        expect([...set.values()]).toStrictEqual([innerRef]);
        const checkpoint = await set.saveCheckpoint();
        set.add(new MutableReference<number>());
        await set.save();
        await set.restoreCheckpoint(checkpoint);
        //await set.save();

        expect([...[...set.values()].map(x => x.hash())]).toStrictEqual([innerRef.hash()]);
        
        // load each element in the set
        for (const ref of set.values()) {
            await ref.loadAllChanges();
        }
        // check equality of inner values
        expect([...[...set.values()].map(x => x.getValue())]).toStrictEqual([innerRef.getValue()]);
    });
})