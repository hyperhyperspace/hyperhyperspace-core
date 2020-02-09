import { RSA, RSAImpl } from 'crypto/ciphers';
import { HashedObject } from 'data/model/HashedObject';
import { RSAPublicKey } from './RSAPublicKey';
import { Hashing } from 'data/model/Hashing';

class RSAKeyPair extends HashedObject {

    static generateKeys(bits: number) {
        let rsa = new RSAImpl();
        rsa.generateKey(bits);

        return RSAKeyPair.fromKeys(rsa.getFormat(), rsa.getPublicKey(), rsa.getPrivateKey());
    }

    static fromKeys(format: string, publicKey: string, privateKey: string) {
        let keyPair = new RSAKeyPair();
        keyPair.format = format;
        keyPair.publicKey = publicKey;
        keyPair.privateKey = privateKey;
        keyPair.init();
        return keyPair;
    }

    static hashPublicKeyPart(format: string, publicKey: string) {
        return Hashing.forValue({format: format, publicKey: publicKey});
    }


    format?: string;
    publicKey?: string;
    privateKey?: string;

    _rsa?: RSA;

    constructor() {
        super();
    }

    init() {
        super.init();
        this._rsa = new RSAImpl();
        this._rsa.loadKeyPair(this.getFormat(), this.getPublicKey(), this.getPrivateKey());
    }

    getFormat(): string {
        return this.format as string;
    }

    getPublicKey() {
        return this.publicKey as string;
    }

    getPrivateKey() {
        return this.privateKey as string;
    }

    makePublicKey() {
        return RSAPublicKey.fromKeys(this.getFormat(), this.getPublicKey());
    }

    sign(text: string) {
        return this._rsa?.sign(text);
    }

    verify(text: string, signature: string) {
        return this._rsa?.verify(text, signature);
    }

    encrypt(plainText: string) {
        return this._rsa?.encrypt(plainText);
    }

    decrypt(cypherText : string) {
        return this._rsa?.decrypt(cypherText);
    }

}

export { RSAKeyPair };