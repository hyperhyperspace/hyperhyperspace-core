import { RNG } from "./RNG";

let getRandomValues : (<T extends Int8Array | Int16Array | Int32Array | Uint8Array | Uint16Array | Uint32Array | Uint8ClampedArray | Float32Array | Float64Array | DataView | null>(array: T) => T);// = require('get-random-values');

if (globalThis?.window?.crypto?.getRandomValues !== undefined) {
    getRandomValues = window.crypto.getRandomValues;
} else {
    getRandomValues = require("get-random-values");
}

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

        return result.toUpperCase();
    }
    
    private randomHex8bitsWord() {

        let result = (((globalThis?.window?.crypto?.getRandomValues !== undefined)? window.crypto.getRandomValues(new Uint8Array(1)) : (getRandomValues(new Uint8Array(1))))[0].toString(16));

        return result.padStart(2, '0');
    }

}

export { BrowserRNG };