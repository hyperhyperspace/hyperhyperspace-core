import { RSA, RSAImpl } from 'crypto/ciphers';
import { HashedObject } from 'data/model/HashedObject';
import { RSAKeyPair } from './RSAKeyPair';

class RSAPublicKey extends HashedObject {

    static className = 'hhs/RSAPublicKey';

    static fromKeys(format: string, publicKey: string) : RSAPublicKey {
        
        let pk = new RSAPublicKey();

        pk.format = format;
        pk.publicKey = publicKey;

        pk.init();

        return pk;
    }

    format?: string;
    publicKey?: string;

    _rsa?: RSA;

    constructor() {
        super();
    }

    init() {
        this._rsa = new RSAImpl();
        this._rsa.loadKeyPair(this.getFormat(), this.getPublicKey());
    }

    validate() {
        return true;
    }

    getClassName() {
        return RSAPublicKey.className;
    }

    getFormat() {
        return this.format as string;
    }

    getPublicKey() {
        return this.publicKey as string;
    }

    getKeyPairHash() {
        return RSAKeyPair.hashPublicKeyPart(this.format as string, this.publicKey as string);
    }

    verifySignature(text: string, signature: string) {

        if (this._rsa === undefined) {
            throw new Error('RSA public key is empty, cannot verify signature');
        }

        return this._rsa.verify(text, signature);
    }

    encrypt(plainText: string) {
        return this._rsa?.encrypt(plainText);
    }

}

HashedObject.registerClass(RSAPublicKey.className, RSAPublicKey);

export { RSAPublicKey };