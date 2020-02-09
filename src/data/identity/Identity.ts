import { RSAPublicKey } from './RSAPublicKey';
import { HashedObject } from 'data/model/HashedObject';

class Identity extends HashedObject {

    info?: object;
    publicKey?: RSAPublicKey;

    constructor() {
        super();
    }

    init() {
        super.init();
    }

    verify(text: string, signature: string) {
        //text; signature; return true; // mock
        return this.publicKey?.verify(text, signature);
    }

    encrypt(text: string) {
        // return text; // mock
        return this.publicKey?.encrypt(text);
    }

}

export { Identity };