import { RSA, RSAImpl } from 'crypto/ciphers';
import { HashedObject } from 'data/model/HashedObject';
import { RSAPublicKey } from './RSAPublicKey';
import { Hashing } from 'data/model/Hashing';

class RSAKeyPair extends HashedObject {

    static className = 'hhs/RSAKeyPair';

    static generate(bits: number) {
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

    format?: string;
    publicKey?: string;
    privateKey?: string;

    _rsa?: RSA;

    constructor() {
        super();
    }

    init() {
        this._rsa = new RSAImpl();
        this._rsa.loadKeyPair(this.getFormat(), this.getPublicKey(), this.getPrivateKey());
    }

    getClassName() {
        return RSAKeyPair.className;
    }

    hash() {
        return RSAKeyPair.hashPublicKeyPart(this.format as string, this.publicKey as string);
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
        return this._rsa?.sign(text) as string;
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

    static hashPublicKeyPart(format: string, publicKey: string) {
        return Hashing.forValue({'_type': 'custom_hashed_object', '_class': RSAKeyPair.className, '_contents': {'format' : format, 'publicKey': publicKey}});
    }
}

HashedObject.registerClass(RSAKeyPair.className, RSAKeyPair);

export { RSAKeyPair };