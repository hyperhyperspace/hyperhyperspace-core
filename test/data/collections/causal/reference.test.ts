import { describeProxy } from 'config';
import { RNGImpl } from 'crypto/random';
import { Identity, RSAKeyPair } from 'data/identity';
import { CausalReference, CausalSet } from 'data/collections';

import { Store } from 'storage/store';
import { IdbBackend } from 'storage/backends';

describeProxy('[CRF] Causal references', () => {

    test('[CRF01] Causal reference set', async (done) => {

        let r = new CausalReference<string>({acceptedTypes: ['string']});

        expect (r.getValue()).toBeUndefined();

        await r.setValue('hi');

        expect (r.getValue() === 'hi').toBeTruthy();

        await r.setValue('bye');

        expect (r.getValue() === 'bye').toBeTruthy();

        done();
    });

    test('[CRF02] Causal reference undo', async (done) => {

        let store = new Store(new IdbBackend('CRF02 - ' + new RNGImpl().randomHexString(128)));

        let kp0 = await RSAKeyPair.generate(2048);
        let i0  = Identity.fromKeyPair({}, kp0);

        await store.save(kp0);
        await store.save(i0);

        let kp1 = await RSAKeyPair.generate(2048);
        let i1  = Identity.fromKeyPair({}, kp1);

        await store.save(kp1);
        await store.save(i1);


        let mutWriters = new CausalSet<Identity>({writer: i0, acceptedTypes: [Identity.className]});
        let ref        = new CausalReference<string>({mutableWriters: mutWriters});

        await store.save(mutWriters);
        await store.save(ref);

        const check = await ref.canSetValue('hi', i1);

        expect(check).toBeFalsy();

        await mutWriters.add(i1, i0);
        await mutWriters.save();

        const recheck = await ref.canSetValue('hi', i1);

        expect(recheck).toBeTruthy();

        await ref.setValue('1', i1);
        await ref.save();

        expect (ref.getValue()).toEqual('1');

        await ref.setValue('2', i1);
        await ref.save();

        expect (ref.getValue()).toEqual('2');

        let mutWritersClone = await store.load(mutWriters.hash()) as CausalSet<Identity>;

        await ref.setValue('3', i1);
        await ref.save();

        expect (ref.getValue()).toEqual('3');

        await ref.setValue('4', i1);
        await ref.save();

        expect (ref.getValue()).toEqual('4');

        await mutWritersClone.delete(i1, i0);

        await mutWritersClone.save();

        let refClone = await store.load(ref.hash()) as CausalReference<string>;

        expect (refClone.getValue()).toEqual('2');

        done();
    });

});