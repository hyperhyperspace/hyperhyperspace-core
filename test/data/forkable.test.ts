import { describeProxy } from 'config';
import { PositiveCounter } from './types/PositiveCounter';

describeProxy('[FRK] Forkable data types', () => {

    test( '[FRK01] Forkable type creation & updating', async () => {
        
        const pc = new PositiveCounter();

        expect(pc.getValue().toString(10)).toEqual('0');

        await pc.changeValueBy(BigInt(10));

        expect(pc.getValue().toString(10)).toEqual('10');

        await pc.changeValueBy(BigInt(-2));

        //console.log(Array.from(pc._terminalEligibleOps));
        //console.log(Array.from(pc._allForkableOps.keys()));

        expect(pc.getValue().toString(10)).toEqual('8');
        
    });

});