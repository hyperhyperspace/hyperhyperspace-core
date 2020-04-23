import { RNG, RNGImpl } from 'crypto/random';

describe('RNG', () => {
    test('Basic RNG length test', () => {
        let rng : RNG = new RNGImpl();
        for (let i=0; i<16; i++) {
            expect(rng.randomHexString(64).length).toEqual(64 / 4);
            expect(rng.randomHexString(4).length).toEqual(4 / 4);
        }

    })
});