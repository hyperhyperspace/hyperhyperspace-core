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

        result = result + this.randomHex8bitsWord().substring(2-length, 2);

        return result;
    }
    
    private randomHex8bitsWord() {

        let result = (getRandomValues(new Uint8Array(1))[0]).toString(16);

        return result.padStart(2, '0');
    }

}

export { BrowserRNG };