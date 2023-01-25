// import the mutable types
import { MutableReference } from 'data/collections/mutable/MutableReference';
import { MutableSet } from 'data/collections/mutable/MutableSet';
import { MutableArray } from 'data/collections/mutable/MutableArray';
// import { GrowOnlySet } from 'index';

describe('[CHK] Checkpoints', () => {
    it('[CHK01] Exporting and importing MutableReference', () => {
        const ref = new MutableReference();
        ref.setValue(1);
        expect(ref.getValue()).toBe(1);
        const refState = ref.exportMutableState();
        ref.setValue(2);
        ref.importMutableState(refState);
        expect(ref.getValue()).toBe(1);
    });

    it('[CHK02] Exporting and importing MutableSet', () => {
        const set = new MutableSet<number>();
        set.add(1);
        expect([...set.values()]).toStrictEqual([1]);
        const setState = set.exportMutableState();
        set.add(2);
        set.importMutableState(setState);
        expect([...set.values()]).toStrictEqual([1]);
    });

    it('[CHK03] Exporting and importing MutableArray', () => {
        const arr = new MutableArray<number>();
        arr.push(1);
        expect([...arr.values()]).toStrictEqual([1]);
        const arrState = arr.exportMutableState();
        arr.push(2);
        arr.importMutableState(arrState);
        expect([...arr.values()]).toStrictEqual([1]);
    });
    
})