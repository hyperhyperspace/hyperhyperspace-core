import { SHAImpl } from '../hashing';
import { Strings } from 'util/strings';

class HMAC {

    hmacSHA256hex(message: string, keyHex: string) {

        if (keyHex.length === 0) {
            throw new Error('Cannot compute HMAC using an empty key');
        }

        if (keyHex.length % 2 === 1) {
            keyHex = keyHex + '0';
        }

        const sha = new SHAImpl();
        const blockLengthHex = 64;
        //const digestLengthHex = 64;

        let shortKeyHex = keyHex;

        if (keyHex.length > blockLengthHex) {
            shortKeyHex = sha.sha256hex(Strings.hexToBase64(keyHex));
        }

        if (keyHex.length < blockLengthHex) {
            while (shortKeyHex.length < blockLengthHex) {
                shortKeyHex = shortKeyHex + keyHex;
            }

            shortKeyHex = shortKeyHex.substring(0, blockLengthHex);
        }
        
        let ipad = '';
        let opad = '';

        let ipadConst = 0x36;
        let opadConst = 0x5c;

        for (let i=0; i<blockLengthHex/2; i++) {
            let ipadVal = ipadConst;
            let opadVal = opadConst;

            const keyVal = Number.parseInt(shortKeyHex[2*i], 16) + 0x10 * Number.parseInt(shortKeyHex[(2*i)+1], 16);
            if (Number.isNaN(keyVal)) {
                throw new Error('HMAC computation: cannot parse hex value ' + shortKeyHex);
            }
            ipadVal = ipadVal ^ keyVal;
            opadVal = opadVal ^ keyVal
            
            ipad = ipad + ipadVal.toString(16).padStart(2, '0');
            opad = opad + opadVal.toString(16).padStart(2, '0');
        }

        const hash1 = sha.sha256base64(Strings.hexToBase64(ipad) + message);
        const hash2 = sha.sha256hex(Strings.hexToBase64(opad) + hash1);

        return hash2;
    }


}

export { HMAC };