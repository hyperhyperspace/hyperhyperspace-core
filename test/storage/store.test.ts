import { Store } from 'storage/store';
import { IdbBackend, MemoryBackend } from 'storage/backends';
import { Hash, HashedObject, HashedSet, HashReference, MutationOp } from 'data/model';

import { SomethingHashed, createHashedObjects } from '../data/types/SomethingHashed';
import { SomethingMutable, SomeMutation } from '../data//types/SomethingMutable';
import { describeProxy } from 'config';
import { CausalHistoryFragment } from 'data/history/CausalHistoryFragment';
import { OpCausalHistory } from 'data/history/OpCausalHistory';


describeProxy('[STR] Storage', () => {
    test('[STR01] Indexeddb-based load / store cycle', async () => {
        let store = new Store(new IdbBackend('test-storage-backend'));
        await testLoadStoreCycle(store);
    });

    test('[STR02] Memory-based load / store cycle', async() => {
        let store = new Store(new MemoryBackend('test-storage-backend'));
        await testLoadStoreCycle(store);
    });

    test('[STR03] Indexeddb-based reference-based load hit', async () => {
        let store = new Store(new IdbBackend('test-storage-backend'));
        await testReferenceBasedLoadHit(store);
    });

    test('[STR04] Memory-based reference-based load hit', async () => {
        let store = new Store(new MemoryBackend('test-storage-backend'));
        await testReferenceBasedLoadHit(store);
    });

    test('[STR05] Indexeddb-based reference-based load miss', async () => {
        let store = new Store(new IdbBackend('test-storage-backend'));
        await testReferenceBasedLoadMiss(store);
    });

    test('[STR06] Memory-based reference-based load miss', async () => {
        let store = new Store(new MemoryBackend('test-storage-backend'));
        await testReferenceBasedLoadMiss(store);
    });
    
    test('[STR07] Indexeddb-based mutation op saving and loading', async () => {
        let store = new Store(new IdbBackend('test-storage-backend'));
        await testMutationOps(store);
    });

    test('[STR08] Memory-based mutation op saving and loading', async () => {
        let store = new Store(new MemoryBackend('test-storage-backend'));
        await testMutationOps(store);
    });

    test('[STR10] Indexeddb-based mutation op saving and auto-loading', async () => {
        let store = new Store(new IdbBackend('test-storage-backend'));
        await testMutationOpAutoLoad(store);
    });

    test('[STR11] Memory-based mutation op saving and auto-loading', async () => {
        let store = new Store(new MemoryBackend('test-storage-backend'));
        await testMutationOpAutoLoad(store);
    });

    test('[STR12] Indexeddb-based mutation op automatic prevOp generation', async () => {
        let store = new Store(new IdbBackend('test-storage-backend'));
        await testPrevOpGeneration(store);
    });

    test('[STR13] Memory-based mutation op automatic prevOp generation', async () => {
        let store = new Store(new MemoryBackend('test-storage-backend'));
        await testPrevOpGeneration(store);
    });

    test('[STR14] Validate history retrieved from IDB store', async () => {
        let store = new Store(new IdbBackend('test-storage-backend'));
        await testHistoryGeneration(store);
    });

    test('[STR15] Validate history retrieved from memory store', async () => {
        let store = new Store(new MemoryBackend('test-storage-backend'));
        await testHistoryGeneration(store);
    });

});

async function testLoadStoreCycle(store: Store) {
    let objects = createHashedObjects();

    let a: SomethingHashed = objects.a;
    let b: SomethingHashed = objects.b;

    await store.save(a);

    let a2 = await store.load(a.hash()) as HashedObject;

    expect(a.equals(a2 as HashedObject)).toBeTruthy();

    let hashedThings = await store.loadByClass(SomethingHashed.className);

    expect(hashedThings.objects[0].hash()).toEqual(b.hash());
    expect(hashedThings.objects[1].hash()).toEqual(a.hash());
}

async function testReferenceBasedLoadHit(store: Store) {
    let objects = createHashedObjects();

    let a: SomethingHashed = objects.a;
    let b: SomethingHashed = objects.b;

    

    await store.save(a);

    
    let result = await store.loadByReferencingClass(SomethingHashed.className, 'reference', b.hash());

    let a2 = result.objects[0];

    expect(a.equals(a2 as HashedObject)).toBeTruthy();

    let hashedThings = await store.loadByClass(SomethingHashed.className);

    expect(hashedThings.objects[0].hash()).toEqual(b.hash());
    expect(hashedThings.objects[1].hash()).toEqual(a.hash());

}

async function testReferenceBasedLoadMiss(store: Store) {
    let objects = createHashedObjects();

    let a: SomethingHashed = objects.a;
    let b: SomethingHashed = objects.b;

    await store.save(a);

    let result = await store.loadByReferencingClass(SomethingHashed.className, 'non-existent-path', b.hash());

    expect(result.objects.length).toEqual(0);
}

async function testMutationOps(store: Store) {
    let sm = new SomethingMutable();

    await sm.testOperation('hello');
    await sm.testOperation('world');
    await sm.testOperation('!');

    await store.save(sm);

    let hash = sm.getLastHash();

    let sm2 = await store.load(hash) as SomethingMutable;

    await sm2.loadOperations();

    let hs = new HashedSet(sm._operations.keys());
    let hs2 = new HashedSet(sm2._operations.keys());

    let h = hs.toArrays().hashes;
    let h2 = hs2.toArrays().hashes;

    expect(h.length).toEqual(h2.length);
    
    for (let i=0; i<h.length; i++) {
        expect(h[i]).toEqual(h2[i]);
    }
}

async function testMutationOpAutoLoad(store: Store) {
    let sm = new SomethingMutable();

    await store.save(sm);

    let hash = sm.getLastHash();

    let sm2 = await store.load(hash) as SomethingMutable;

    sm2.watchForChanges(true);

    await sm.testOperation('hello');
    await sm.testOperation('world');
    await sm.testOperation('!');

    await store.save(sm);

    let hs = new HashedSet(sm._operations.keys());
    let hs2 = new HashedSet(sm2._operations.keys());

    let h = hs.toArrays().hashes;
    let h2 = hs2.toArrays().hashes;

    expect(h.length).toEqual(h2.length);
    

    for (let i=0; i<h.length; i++) {
        expect(h[i]).toEqual(h2[i]);
    }
}

async function testPrevOpGeneration(store: Store) {
    let sm = new SomethingMutable();
    await store.save(sm);
    await sm.testOperation('hello');

    let hash = sm.getLastHash();
    let sm2 = await store.load(hash) as SomethingMutable;
    await sm2.testOperation('another');
    await store.save(sm2);
    
    await sm.testOperation('world');
    await sm.testOperation('!');
    await store.save(sm);
    

    let sm3 = await store.load(hash) as SomethingMutable;
    await sm3.loadOperations();

    let world: SomeMutation|undefined = undefined;

    for (const op of sm3._operations.values()) {
        const mut = op as SomeMutation;

        if (mut.payload === 'world') {
            world = mut;
        }
    }

    expect(world !== undefined).toBeTruthy();
    if (world !== undefined) {
        expect(world.prevOps?.toArrays().elements.length === 2).toBeTruthy();
        let another = false;
        let hello   = false;
        for (const opRef of (world.prevOps as HashedSet<HashReference<MutationOp>>).toArrays().elements) {
            let op = sm3._operations.get(opRef.hash);
            another = another || op?.payload === 'another';
            hello   = hello   || op?.payload === 'hello';
        } 

        expect(another).toBeTruthy();
        expect(hello).toBeTruthy();
    }
}

async function testHistoryGeneration(store: Store) {
    let sm = new SomethingMutable();

    await store.save(sm);

    await sm.testOperation('hello');
    await sm.testOperation('world');

    await sm.saveQueuedOps();

    let hash = sm.getLastHash();

    let sm2 = await store.load(hash) as SomethingMutable;

    await sm2.loadAllChanges();

    await sm2.testOperation('!!');

    await sm.testOperation('!');

    await sm2.saveQueuedOps();
    await sm.saveQueuedOps();

    await sm.loadAllChanges();

    let hello: SomeMutation|undefined = undefined;
    let world: SomeMutation|undefined = undefined;
    let bang: SomeMutation|undefined = undefined;
    let bangbang: SomeMutation|undefined = undefined;

    for (const op of sm._operations.values()) {
        const mut = op as SomeMutation;

        if (mut.payload === 'hello') {
            hello = mut;
            //console.log('hello: ' + hello.hash());
        }
        if (mut.payload === 'world') {
            world = mut;
            //console.log('world: ' + world.hash());
        }
        if (mut.payload === '!') {
            bang = mut;
            //console.log('!: ' + bang.hash());
        }

        if (mut.payload === '!!') {
            bangbang = mut;
            //console.log('!!: ' + bangbang.hash());
        }
    }

    let frag = new CausalHistoryFragment(sm.getLastHash());

    const bangHistory = await store.loadOpCausalHistory(bang?.hash() as Hash) as OpCausalHistory;
    const bangbangHistory = await store.loadOpCausalHistory(bangbang?.hash() as Hash) as OpCausalHistory;
    const worldHistory = await store.loadOpCausalHistory(world?.hash() as Hash) as OpCausalHistory;
    const helloHistory = await store.loadOpCausalHistory(hello?.hash() as Hash) as OpCausalHistory

    const bangHistoryByHash = await store.loadOpCausalHistoryByHash(bangHistory.causalHistoryHash);

    expect(bangHistoryByHash?.causalHistoryHash).toEqual(bangHistory.causalHistoryHash);
    expect(bangHistoryByHash?.opHash).toEqual(bangHistory.opHash);

    expect(bangHistory.computedProps?.height).toEqual(3);
    expect(bangHistory.computedProps?.size).toEqual(3);

    frag.add(bangHistory);

    expect(frag.missingPrevOpHistories.size).toEqual(1);
    
    expect(frag.missingPrevOpHistories.has(worldHistory?.hash() as Hash)).toBeTruthy();

    expect(frag.terminalOpHistories.size).toEqual(1);
    expect(frag.getTerminalOps().has(bang?.hash() as Hash));



    expect(bangbangHistory.computedProps?.height).toEqual(3);
    expect(bangbangHistory.computedProps?.size).toEqual(3);

    frag.add(bangbangHistory);

    expect(frag.missingPrevOpHistories.size).toEqual(1);
    expect(frag.missingPrevOpHistories.has(worldHistory?.hash() as Hash)).toBeTruthy();

    expect(frag.terminalOpHistories.size).toEqual(2);
    expect(frag.getTerminalOps().has(bang?.hash() as Hash));
    expect(frag.getTerminalOps().has(bangbang?.hash() as Hash));



    expect(worldHistory.computedProps?.height).toEqual(2);
    expect(worldHistory.computedProps?.size).toEqual(2);

    frag.add(worldHistory);
    
    expect(frag.missingPrevOpHistories.size).toEqual(1);
    expect(frag.missingPrevOpHistories.has(helloHistory?.hash() as Hash)).toBeTruthy();

    expect(frag.terminalOpHistories.size).toEqual(2);
    expect(frag.getTerminalOps().has(bang?.hash() as Hash));
    expect(frag.getTerminalOps().has(bangbang?.hash() as Hash));


    expect(helloHistory.computedProps?.height).toEqual(1);
    expect(helloHistory.computedProps?.size).toEqual(1);

    frag.add(helloHistory);
    
    expect(frag.terminalOpHistories.size).toEqual(2);
    expect(frag.missingPrevOpHistories.size).toEqual(0);

    //expect(frag.checkAndComputeProps(new Map())).toBeTruthy();
}