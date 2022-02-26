import { HashedObject, HashedSet, Serialization, Context } from 'data/model';

import { SomethingHashed, createHashedObjects } from './types/SomethingHashed';
import { OverrideIds } from './types/OverrideIds';
import { HashedMap } from 'data/model/immutable';
import { describeProxy } from 'config';

describeProxy('[MOD] Data model', () => {

    test( '[MOD01] Basic types', () => {
        
        const original = ['hello', 1.0, false, 2.5, 'bye', true];
        const context = new Context();
        const literalization  = HashedObject.literalizeField('original', original, context);
        const reconstructed = HashedObject.deliteralizeField(literalization.value, context);

        for (let i=0; i<original.length; i++) {
            expect(original[i]).toEqual(reconstructed[i]);
        }
    });

    test('[MOD02] Hashed sets', () => {
        
        const set1 = new HashedSet();
        const set2 = new HashedSet();

        const elements = [1, 2, 3, 4, 'five', 'six', true];

        for (let element of elements) {
            set1.add(element);
            set2.add(element);
        }

        const literal1 = HashedObject.literalizeField('set1', set1);
        const literal2 = HashedObject.literalizeField('set2', set2);

        expect(Serialization.default(literal1.value)).toEqual(Serialization.default(literal2.value));
        
        expect(set1.has('five')).toBeTruthy();
        expect(set1.has('seven')).toBeFalsy();
    });

    test('[MOD03] Hashed maps', () => {

        const map1 = new HashedMap();
        const map2 = new HashedMap();

        const items = [['a', 'five'], ['b', 'three']];

        for (let item of items) {
            map1.set(item[0], item[1]);
            map2.set(item[0], item[1]);
        }

        expect(map1.equals(map2)).toBeTruthy();

        map1.set('a', 'nonsense');

        expect(map1.equals(map2)).toBeFalsy();

        const literal1 = map2.literalize();

        const map3 = HashedMap.deliteralize(literal1.value, new Context());

        expect(map2.equals(map3)).toBeTruthy();
    });

    test('[MOD04] HashedObject subclasses', () => {


        let os = createHashedObjects();

        let a: SomethingHashed = os.a;

        let a2 = a.clone();

        expect(a.equals(a2)).toBeTruthy();

        a.reference = undefined;

        expect(a.equals(a2)).toBeFalsy();
    });

    test('[MOD05] Id override', () => {

        let a = new OverrideIds('hello, world!', true);
        let b = new OverrideIds('hello, world!', true);
        let c = new OverrideIds('hello, world!', false);

        expect(a.equals(b)).toBeTruthy();
        expect(a.equals(c)).toBeFalsy();

    });
});