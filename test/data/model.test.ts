import { HashedObject, HashedSet, Serialization } from 'data/model';

class SomethingHashed extends HashedObject {
    name?: string;
    amount?: number;
    things?: HashedSet<any>;

    constructor() {
        super();
        this.things = new HashedSet();
    }
}

describe('Data model', () => {
    test( 'Basic types', () => {
        
        const original = ['hello', 1.0, false, 2.5, 'bye', true];
        const literal  = HashedObject.literalize(original);
        const reconstructed = HashedObject.deliteralize(literal);

        for (let i=0; i<original.length; i++) {
            expect(original[i]).toEqual(reconstructed[i]);
        }
    });

    test('Hashed sets', () => {
        
        const set1 = new HashedSet();
        const set2 = new HashedSet();

        const elements = [1, 2, 3, 4, 'five', 'six', true];

        for (let element of elements) {
            set1.add(element);
            set2.add(element);
        }

        const literal1 = HashedObject.literalize(set2);
        const literal2 = HashedObject.literalize(set2);

        expect(Serialization.default(literal1)).toEqual(Serialization.default(literal2));
        
        expect(set1.has('five')).toBeTruthy();
        expect(set1.has('seven')).toBeFalsy();
    });

    test('HashedObject subclasses', () => {
        let a = new SomethingHashed();
        let b = new SomethingHashed();

        let name = 'la la la';
        let amount = 199;

        a.name = name;
        a.amount = amount;

        let name2 = 'le le le';
        let amount2 = 3;

        b.name = name2;
        b.amount = amount2;

        a.things?.add(b);

        let a_literal = HashedObject.literalize(a);

        let a2 = HashedObject.deliteralize(a_literal);

        expect(a.equals(a2)).toBeTruthy();
    });
});