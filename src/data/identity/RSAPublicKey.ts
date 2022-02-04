import { RSA, RSADefaults } from 'crypto/ciphers';
import { RSAKeyPair } from './RSAKeyPair';

import { HashedObject } from '../model/immutable/HashedObject';

class RSAPublicKey extends HashedObject {

    static className = 'hhs/v0/RSAPublicKey';

    static fromKeys(publicKey: string) : RSAPublicKey {
        
        let pk = new RSAPublicKey();

        pk.publicKey = publicKey;

        pk.init();

        return pk;
    }

    publicKey?: string;

    _rsaPromise?: Promise<RSA>;

    constructor() {
        super();
    }

    init() {
        this._rsaPromise = this.initRSA();
    }

    private async initRSA(): Promise<RSA> {
        const _rsa = new RSADefaults.impl();
        await _rsa.loadKeyPair(this.getPublicKey());
        return _rsa;
    }

    async validate() {
        // TODO: self sign??
        return true;
    }

    getClassName() {
        return RSAPublicKey.className;
    }

    getPublicKey() {
        return this.publicKey as string;
    }

    getKeyPairHash() {
        return RSAKeyPair.hashPublicKeyPart(this.publicKey as string);
    }

    async verifySignature(text: string, signature: string) {

        if (this._rsaPromise === undefined) {
            throw new Error('RSA public key is empty, cannot verify signature');
        }

        return (await this._rsaPromise).verify(text, signature);
    }

    async encrypt(plainText: string) {

        if (this._rsaPromise === undefined) {
            throw new Error('RSA public key is empty, cannot encrypt');
        }

        return (await this._rsaPromise).encrypt(plainText);
    }

}

HashedObject.registerClass(RSAPublicKey.className, RSAPublicKey);

export { RSAPublicKey };