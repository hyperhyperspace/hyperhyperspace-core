import { describeProxy } from 'config';
import { PositiveCounter } from './types/PositiveCounter';
import { Store } from 'storage/store';
import { IdbBackend } from 'storage/backends';
import { RNGImpl } from 'crypto/random';

describeProxy('[FRK] Forkable data types', () => {

    test('[FRK01] Linear updates on forkable type', async () => {
        
        const pc = new PositiveCounter();

        expect(pc.getValue().toString(10)).toEqual('0');

        await pc.changeValueBy(BigInt(10));

        expect(pc.getValue().toString(10)).toEqual('10');

        await pc.changeValueBy(BigInt(-2));

        //console.log(Array.from(pc._terminalEligibleOps));
        //console.log(Array.from(pc._allForkableOps.keys()));

        expect(pc.getValue().toString(10)).toEqual('8');
        
    });

    test('[FRK02] 2-way initial merge on forkable type', async () => {

        const pc = new PositiveCounter();

        const store = new Store(new IdbBackend(new RNGImpl().randomHexString(128)));

        await store.save(pc);

        const pc_clone = (await store.load(pc.getLastHash())) as PositiveCounter;

        await pc.changeValueBy(BigInt(1));
        await pc_clone.changeValueBy(BigInt(2));

        expect(pc.getValue().toString(10)).toEqual('1');
        expect(pc_clone.getValue().toString(10)).toEqual('2');

        await pc.save();
        await pc_clone.save();

        await pc.loadAllChanges();
        await pc_clone.loadAllChanges();

        // fork choice should choose the same one in both copies.
        expect(pc.getValue().toString(10)).toEqual(pc_clone.getValue().toString(10));
        
        expect(pc.getUnsettledValue().toString(10)).toEqual('3');
        expect(pc_clone.getUnsettledValue().toString(10)).toEqual('3');

        expect(pc.isSettled()).toEqual(false);
        expect(pc.canSettle()).toEqual(true);

        await pc.settle();
        expect(pc.getValue().toString(10)).toEqual('3');

        await pc_clone.settle();
        expect(pc_clone.getValue().toString(10)).toEqual('3');

        await pc.save();
        await pc_clone.save();

        await pc.loadAllChanges();
        await pc_clone.loadAllChanges();

        expect(pc.getValue().toString(10)).toEqual('3');

        expect(pc_clone.getValue().toString(10)).toEqual('3');

        expect(pc.isSettled()).toEqual(true);
        expect(pc_clone.isSettled()).toEqual(true);

    });

    test('[FRK03] 3-way initial merge on forkable type', async () => {

        const pc1 = new PositiveCounter();

        const store = new Store(new IdbBackend(new RNGImpl().randomHexString(128)));

        await store.save(pc1);

        const pc2 = (await store.load(pc1.getLastHash())) as PositiveCounter;
        const pc3 = (await store.load(pc1.getLastHash())) as PositiveCounter;

        await pc1.changeValueBy(BigInt(1));
        await pc2.changeValueBy(BigInt(2));
        await pc3.changeValueBy(BigInt(3));

        expect(pc1.getValue().toString(10)).toEqual('1');
        expect(pc2.getValue().toString(10)).toEqual('2');
        expect(pc3.getValue().toString(10)).toEqual('3');

        await pc1.save();
        await pc2.save();
        await pc3.save();


        await pc1.loadAllChanges();
        await pc2.loadAllChanges();
        await pc3.loadAllChanges();

        // fork choice should choose the same one in both copies.
        expect(pc1.getValue().toString(10)).toEqual(pc2.getValue().toString(10));
        expect(pc2.getValue().toString(10)).toEqual(pc3.getValue().toString(10));
        
        expect(pc1.getUnsettledValue().toString(10)).toEqual('6');
        expect(pc2.getUnsettledValue().toString(10)).toEqual('6');
        expect(pc3.getUnsettledValue().toString(10)).toEqual('6');

        expect(pc1.isSettled()).toEqual(false);
        expect(pc1.canSettle()).toEqual(true);

        await pc1.settle();
        expect(pc1.getValue().toString(10)).toEqual('6');

        await pc2.settle();
        expect(pc2.getValue().toString(10)).toEqual('6');

        await pc3.settle();
        expect(pc3.getValue().toString(10)).toEqual('6');

        await pc1.save();
        await pc2.save();
        await pc3.save();

        await pc1.loadAllChanges();
        await pc2.loadAllChanges();
        await pc3.loadAllChanges();

        expect(pc1.getValue().toString(10)).toEqual('6');

        expect(pc2.getValue().toString(10)).toEqual('6');

        expect(pc3.getValue().toString(10)).toEqual('6');

        expect(pc1.isSettled()).toEqual(true);
        expect(pc2.isSettled()).toEqual(true);
        expect(pc3.isSettled()).toEqual(true);

    });

    test('[FRK04] A far-removed uncle', async () => {

        const pc1 = new PositiveCounter();

        const store = new Store(new IdbBackend(new RNGImpl().randomHexString(128)));

        await pc1.changeValueBy(BigInt(1));
        await store.save(pc1);

        const pc2 = (await store.load(pc1.getLastHash())) as PositiveCounter;

        for (let i=0; i<50; i++) {
            await pc1.changeValueBy(BigInt(1));
        }

        await pc1.save();

        await pc2.changeValueBy(BigInt(-1));
        await pc2.save();

        expect(pc1.getValue().toString(10)).toEqual('51');

        await pc1.loadAllChanges();

        console.log(pc1?._currentForkTerminalOp?.getClassName());

        expect(pc1.getValue().toString(10)).toEqual('51'); //
        expect(pc1.isSettled()).toBeFalsy();
        expect(pc1.canSettle()).toBeTruthy();
        expect(pc1.getUnsettledValue().toString(10)).toEqual('50');
        await pc1.settle();
        expect(pc1.getValue().toString(10)).toEqual('50');
        expect(pc1.isSettled()).toEqual(true);

        expect(pc2.getUnsettledValue().toString(10)).toEqual('0');
        expect(pc2.canSettle()).toBeTruthy();
        expect(pc2.isSettled()).toBeTruthy();

        await pc2.loadAllChanges();
        await pc2.settle();
        expect(pc2.getValue().toString(10)).toEqual('50');
        expect(pc2.isSettled()).toEqual(true);
    });

});