import { SHAImpl } from '../hashing';

class HMAC {

    hmacSHA256hex(message: string, key: string) {

        const sha = new SHAImpl();
        const blockLengthHex = 128;
        //const digestLengthHex = 64;

        let shortKey = key;

        if (key.length > blockLengthHex) {
            shortKey = sha.sha256hex(key);
        }

        let ipad = '';
        let opad = '';

        let ipadConst = 0x36;
        let opadConst = 0x5c;

        for (let i=0; i<blockLengthHex; i++) {
            let ipadVal = ipadConst;
            let opadVal = opadConst;

            if (i<shortKey.length) {
                const keyVal = Number.parseInt(shortKey[i], 16);
                ipadVal = ipadVal ^ keyVal;
                opadVal = opadVal ^ keyVal
            }
            
            ipad = ipad + ipadVal.toString(16).padStart(2, '0');
            opad = opad + opadVal.toString(16).padStart(2, '0');
        }

        const hash1 = sha.sha256hex(ipad + message);
        const hash2 = sha.sha256hex(opad + hash1);

        return hash2;
    }


}

export { HMAC };