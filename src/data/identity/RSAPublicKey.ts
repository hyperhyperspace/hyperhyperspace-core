import { RSA, RSAImpl } from 'crypto/ciphers';
import { HashedObject } from 'data/model/HashedObject';

class RSAPublicKey extends HashedObject {

    static fromKeys(format: string, publicKey: string) {
        
        let pk = new RSAPublicKey();

        pk.format = format;
        pk.publicKey = publicKey;

        pk.init();

        return publicKey;
    }

    format?: string;
    publicKey?: string;

    _rsa?: RSA;

    constructor() {
        super();
    }

    init() {
        super.init();
        this._rsa = new RSAImpl();
        this._rsa.loadKeyPair(this.getFormat(), this.getPublicKey());
    }

    getFormat() {
        return this.format as string;
    }

    getPublicKey() {
        return this.publicKey as string;
    }

    verify(text: string, signature: string) {
        return this._rsa?.verify(text, signature);
    }

    encrypt(plainText: string) {
        return this._rsa?.encrypt(plainText);
    }

}

export { RSAPublicKey };