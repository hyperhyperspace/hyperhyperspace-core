// import the mutable types
import { MutableReference } from 'data/collections/mutable/MutableReference';
import { MutableSet } from 'data/collections/mutable/MutableSet';
import { MutableArray } from 'data/collections/mutable/MutableArray';

// add a memory store to the test
import { CausalArray, CausalReference, CausalSet, MemoryBackend, RNGImpl, Store } from 'index';
describe('[CHK] Checkpoints', () => {
    it('[CHK01] Exporting and importing MutableReference', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const ref = new MutableReference();
        // check that it supports checkpoints
        expect(ref._supportsCheckpoints).toBe(true);

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
        // check that it supports checkpoints
        expect(set._supportsCheckpoints).toBe(true);

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
        // check that it supports checkpoints
        expect(arr._supportsCheckpoints).toBe(true);

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
            ref.setStore(store);
            await ref.loadAllChanges();
        }
        // check equality of inner values
        expect([...[...arr.values()].map(x => x.getValue())]).toStrictEqual([innerRef.getValue()]);
    });
    
    it('[CHK07] Exporting and importing GrowOnlySet', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const set = new MutableSet<number>();
        // check that it supports checkpoints
        expect(set._supportsCheckpoints).toBe(true);

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
            ref.setStore(store);
            await ref.loadAllChanges();
        }
        // check equality of inner values
        expect([...[...set.values()].map(x => x.getValue())]).toStrictEqual([innerRef.getValue()]);
    });

    it('[CHK09] Exporting and importing CausalReference', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const ref = new CausalReference<number>();
        // check that it supports checkpoints
        expect(ref._supportsCheckpoints).toBe(true);

        ref.setStore(store);
        ref.setValue(1);
        await ref.save();
        expect(ref.getValue()).toStrictEqual(1);
        const checkpoint = await ref.saveCheckpoint();
        ref.setValue(2);
        await ref.save();
        await ref.restoreCheckpoint(checkpoint);
        expect(ref.getValue()).toStrictEqual(1);
    });
    
    it('[CHK10] Exporting and importing CausalReference with HashedObject members', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const ref = new CausalReference<MutableReference<number>>();
        ref.setStore(store);
        const innerRef = new MutableReference<number>();
        innerRef.setStore(store);
        innerRef.setValue(1);
        await innerRef.save();
        ref.setValue(innerRef);
        await ref.save();
        expect(ref.getValue()).toStrictEqual(innerRef);
        const checkpoint = await ref.saveCheckpoint();
        ref.setValue(new MutableReference<number>());
        await ref.save();
        await ref.restoreCheckpoint(checkpoint);

        expect(ref.getValue()?.hash()).toStrictEqual(innerRef.hash());
        
        // load the inner reference
        ref.getValue()?.setStore(store);
        await ref.getValue()?.loadAllChanges();
        // check equality of inner values
        expect(ref.getValue()?.getValue()).toStrictEqual(innerRef.getValue());
        // make sure the inner value is 1
        expect(ref.getValue()?.getValue()).toStrictEqual(1);
    });
    
    it('[CHK11] Exporting and importing CausalSet', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const set = new CausalSet<number>();
        // check that it supports checkpoints:
        expect(set._supportsCheckpoints).toStrictEqual(true);
        
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

    it('[CHK12] Exporting and importing CausalSet with HashedObject members', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const set = new CausalSet<MutableReference<number>>();
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
        
        // make sure the inner value is 1
        expect([...[...set.values()].map(x => x.getValue())]).toStrictEqual([1]);
    });
    
    it('[CHK13] Exporting and importing CausalArray', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const array = new CausalArray<number>();
        // check that it supports checkpoints:
        expect(array._supportsCheckpoints).toStrictEqual(true)

        array.setStore(store);
        array.push(1);
        await array.save();
        expect([...array.values()]).toStrictEqual([1]);
        const checkpoint = await array.saveCheckpoint();
        array.push(2);
        await array.save();
        await array.restoreCheckpoint(checkpoint);
        expect([...array.values()]).toStrictEqual([1]);
    });
    
    it('[CHK14] Exporting and importing CausalArray with HashedObject members', async () => {
        const store = new Store(new MemoryBackend('test-' + new RNGImpl().randomHexString(128)));
        const array = new CausalArray<MutableReference<number>>();
        array.setStore(store);
        // add a MutableReference to the array
        const innerRef = new MutableReference<number>();
        innerRef.setStore(store);
        innerRef.setValue(1);
        await innerRef.save();
        
        // add another
        const innerRef2 = new MutableReference<number>();
        innerRef2.setStore(store);
        innerRef2.setValue(2);
        await innerRef2.save();

        array.push(innerRef);
        array.push(innerRef2);
        await array.save();

        expect(new Set([...array.values()])).toStrictEqual(new Set([innerRef, innerRef2]));

        const checkpoint = await array.saveCheckpoint();
        array.push(new MutableReference<number>());
        await array.save();
        await array.restoreCheckpoint(checkpoint);

        expect([...[...array.values()].map(x => x.hash())]).toStrictEqual([innerRef.hash(), innerRef2.hash()]);
        
        // load each element in the array
        for (const ref of array.values()) {
            ref.setStore(store);
            await ref.loadAllChanges();
        }
        // check equality of inner values
        expect([...[...array.values()].map(x => x.getValue())]).toStrictEqual([innerRef.getValue(), innerRef2.getValue()]);
        
        // make sure the inner values are 1 and 2
        expect([...[...array.values()].map(x => x.getValue())]).toStrictEqual([1, 2]);
    });
})