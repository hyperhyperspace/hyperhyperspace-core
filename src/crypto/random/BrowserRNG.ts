import { getRandomValues } from 'rngpoly';

import { RNG } from "./RNG";

class BrowserRNG implements RNG {

    randomHexString(bits: number): string {

        if (bits % 4 !== 0) {
            throw new Error('Hex strings must have a size in bits that is a multiple of 4');
        }

        let length = bits / 4;
        const step = 2;
        let result = '';
        while (length >= step) {
            result = result + this.randomHex8bitsWord();
            length = length - step;
        }

        result = result + this.pad((getRandomValues(new Uint8Array(1))[0]).toString(16), 2).substring(2-length, 2);

        return result;
    }
    
    private randomHex8bitsWord() {
        return this.pad((getRandomValues(new Uint8Array(1))[0]).toString(16), 2)
    }

    private pad = (xs: string, n: number) => {
        while (xs.length < n) {
          xs = '0' + xs;
        }
    
        return xs;
    }
}

export { BrowserRNG };