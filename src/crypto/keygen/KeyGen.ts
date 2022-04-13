
// Generates a 32-bytes key using a seed string, a salt, and a number of rounds.

import { Strings } from 'util/strings';
import { HMAC } from '../hmac/HMAC';

class KeyGen {

    derive(seedHex: string, saltHex: string, rounds: number) {

        const hmac = new HMAC();

        const values = new Array<string>();

        for (let i=0; i<rounds; i++) {
            
            const roundVal = i===0? Strings.hexToBase64(saltHex) : Strings.hexToBase64(values[i-1]);

            values.push(hmac.hmacSHA256hex(roundVal, seedHex));
        }

        let result = '';
        const nibbleLength = values[0].length;

        for (let i=0; i<nibbleLength; i++) {
            let ival = Number.parseInt(values[0][i], 16);

            for (let j=1; j<rounds; j++) {
                ival = ival ^ Number.parseInt(values[j][i], 16);
            }

            result = result + ival.toString(16);
        }

        return result;
    }
}

export { KeyGen };