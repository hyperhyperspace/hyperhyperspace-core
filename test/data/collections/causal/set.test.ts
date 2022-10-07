import { describeProxy } from 'config';
import { RNGImpl } from 'crypto/random';
import { CausalSet } from 'data/collections';
import { Identity, RSAKeyPair } from 'data/identity';
import { IdbBackend } from 'storage/backends';
import { Store } from 'storage/store';

describeProxy('[CST] Causal sets', () => {
    
    test('[CST01] Causal set add / remove', async (done) => {
        let s = new CausalSet<string>({acceptedTypes: ['string']});

        expect(s.has('hi')).toBeFalsy();

        await s.add('hi');

        expect(s.has('hi')).toBeTruthy();

        await s.delete('hi');

        expect(s.has('hi')).toBeFalsy();

        done();
    });

    test('[CST02] Causal set undo', async (done) => {
        let store = new Store(new IdbBackend('CST02 - ' + new RNGImpl().randomHexString(128)));

        // 3 identities to use in the test

        let kp0 = await RSAKeyPair.generate(2048);
        let i0  = Identity.fromKeyPair({}, kp0);

        await store.save(kp0);
        await store.save(i0);

        let kp1 = await RSAKeyPair.generate(2048);
        let i1  = Identity.fromKeyPair({}, kp1);

        await store.save(kp1);
        await store.save(i1);

        let kp2 = await RSAKeyPair.generate(2048);
        let i2  = Identity.fromKeyPair({}, kp2);

        await store.save(kp2);
        await store.save(i2);

        // 3 causal sets to use in the test (causal sets contain elements and attestations of 
        // membership for those elements): s0 defines the writers to s1, that in turn defines
        // who has access to writing to s2.

        let s0 = new CausalSet<Identity>({writer: i0, acceptedTypes: [Identity.className]});
        let s1 = new CausalSet<Identity>({mutableWriters: s0, acceptedTypes: [Identity.className]});
        let s2 = new CausalSet<string>({mutableWriters: s1, acceptedTypes: ['string']});

        await s0.add(i1)

        await store.save(s0);
        await store.save(s1);
        await store.save(s2);

        // s0= {i1}, s1= {}, s2= {}


        await s1.add(i2, i1);
        await s2.add('hi', i2);

        //               causal dep         causal dep
        //              v---------*       v------------*
        // s0= {i1, att(i1)}, s1= {i2, att(i2)}, s2= {'hi'}

        // The addition of i2 to s1 is causally dependent on an attestation of i1
        // belonging to s0. The addition of 'hi' to s2 by i2 is also causally dependent
        // on an attestation of i2 belonging to s1.

        // Not shown above: att(x) is causally dependent on x being in the set as well!
        // e.g. att(i1) depends upon the addition of i1 to s0, the same for i2 and s1.

        expect(s0.has(i1)).toBeTruthy();
        expect(s1.has(i2)).toBeTruthy();
        expect(s2.has('hi')).toBeTruthy();

        let s0_too = await store.load(s0.hash()) as CausalSet<Identity>;

        await s1.save();
        await s2.save();

        //                 causal dep           causal dep
        //              v--------------*      v------------*
        // s0=     {i1, att(i1)}, s1= {i2, att(i2)}, s2= {'hi'}
        // s0_too= {i1}

        let deleted = await s0_too.delete(i1);
        await s0_too.save();

        //                X----UNDO----v       X----UNDO---v
        // s0=     {i1, att(i1)}, s1= {i2, att(i2)}, s2*= {}
        // s0_too= {}

        // Since att(i1) does not exist in s0_too (s0_too was loaded before the attestation
        // was saved on "await s1.save()"), att(i1) is undone when s0_too is saved after the
        // deletion if i1. This in turn makes the addition of i2 to s1 to be invalidated as
        // well, and then by cascade the attestation att(i2), and finally the addition of
        // 'hi' to s2 by i2.

        expect(deleted).toBeTruthy();

        let s1_too = await store.load(s1.hash()) as CausalSet<Identity>;
        let s2_too = await store.load(s2.hash()) as CausalSet<string>;
        
        // s0=     {i1, att(i1)}, s1_too= {}, s2_too= {}
        // s0_too= {}


        expect(s1_too.has(i2)).toBeFalsy();
        expect(s2_too.has('h1')).toBeFalsy();

        done();

    });

    test('[CST03] Causal set redo', async (done) => {
        let store = new Store(new IdbBackend('CST02 - ' + new RNGImpl().randomHexString(128)));

        // 4 identities to use in the test

        let kp0 = await RSAKeyPair.generate(2048);
        let i0  = Identity.fromKeyPair({}, kp0);

        await store.save(kp0);
        await store.save(i0);

        let kp1 = await RSAKeyPair.generate(2048);
        let i1  = Identity.fromKeyPair({}, kp1);

        await store.save(kp1);
        await store.save(i1);

        let k2 = await RSAKeyPair.generate(2048);
        let i2  = Identity.fromKeyPair({}, k2);

        await store.save(k2);
        await store.save(i2);


        let kp3 = await RSAKeyPair.generate(2048);
        let i3  = Identity.fromKeyPair({}, kp3);

        await store.save(kp3);
        await store.save(i3);

        // 3 causal sets to use in the test (causal sets contain elements and attestations of 
        // membership for those elements): s0 defines the writers to s1, that in turn defines
        // who has access to writing to s2.

        let s0 = new CausalSet<Identity>({writer: i0, acceptedTypes: [Identity.className]});
        let s1 = new CausalSet<Identity>({mutableWriters: s0, acceptedTypes: [Identity.className]});
        let s2 = new CausalSet<string>({mutableWriters: s1, acceptedTypes: ['string']});

        await s0.add(i1);
        await s0.add(i2);

        await store.save(s0);
        await store.save(s1);
        await store.save(s2);

        // s0= {i1, i2}, s1= {}, s2= {}

        let s0_too = await store.load(s0.hash()) as CausalSet<Identity>;

        await s1.add(i3, i1);
        await s1.save();
    
        //                        causal dep 
        //                       v----------*
        // s0=     {i1, i2, att(i1)}, s1= {i3}, s2= {}
        // s0_too= {i1, i2}

        expect(s0.has(i1)).toBeTruthy();
        expect(s0.has(i2)).toBeTruthy();
        expect(s1.has(i3)).toBeTruthy();

        let s1_too = await store.load(s1.hash()) as CausalSet<Identity>;        

        await s2.add('hi', i3);
        expect(s2.has('hi')).toBeTruthy();
        await s2.save();

        //                         causal dep            causal dep
        //                     v--------------*       v------------*
        // s0=     {i1, i2, att(i1)}, s1=     {i3, att(i3)}, s2= {'hi'}
        // s0_too= {i1, i2}           s1_too= {i3}

        // Not shown above: att(x) is causally dependent on x being in the set!

        expect(s1_too.has(i3));
        let deleted = await s1_too.delete(i3, i2);
        await s1_too.save();

        expect(deleted).toBeTruthy();

        let s2_too = await store.load(s2.hash()) as CausalSet<string>;
        expect(s2_too.has('h1')).toBeFalsy();

        //                                            X----UNDO-ADD----v
        // s0=     {i1, i2, att(i1)}, s1=     {i3, att(i3)}, s2=     {'hi'}
        // s0_too= {i1, i2, att(i2)}  s1_too= {},            s2_too= {}  <----- when s2 is reloaded,
        //                                                                      'hi' is no longer there

        // The attestation att(i3) was never loaded to s1_too, hence when s1_too is saved
        // to the store after deleting i3, it is undone. The addition of 'hi' to s2 is
        // causally dependent on att(i3) (since s2.mutableWriters = s1), and therefore
        // it is undone by cascade.

        
        deleted = await s0_too.delete(i2);
        await s0_too.save();

        expect(deleted).toBeTruthy();

        
        // s0=     {i1, i2, att(i1)}, s1=     {i3, att(i3)},  s2=         {'hi'}
        //                  X--UNDO-DELETE--v         X-------REDO-ADD-------v
        // s0_too= {i1, att(i2)},     s1(*)=  {i3, att(i3)},  s2_too_too= {'hi'}

        // The attestation att(i1) was never loaded into s0_too, so after removing i2
        // and saving it is undone by thes tore. This undoes the deletion of i3, and
        // re-does the attestation att(i3) that has been invalidated. By cascade,
        // the addition if 'hi' to s2, that had been invalidated before, is also re-done.

        // (*) s1 is not reloaded, so this change is not visible in our state (just 
        //     inside the store)


        let s2_too_too = await store.load(s2.hash()) as CausalSet<string>;
        expect(s2_too_too.has('hi')).toBeTruthy();

        done();

    }, 20000);

});