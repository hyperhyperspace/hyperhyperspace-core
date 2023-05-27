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
        expect(pc.getValue().toString(10)).toEqual('3');

        await pc.save();
        await pc_clone.save();

        await pc.loadAllChanges();
        await pc_clone.loadAllChanges();

        expect(pc.getValue().toString(10)).toEqual('3');

        expect(pc.getValue().toString(10)).toEqual('3');

        expect(pc.isSettled()).toEqual(true);
        expect(pc_clone.isSettled()).toEqual(true);

    });

});