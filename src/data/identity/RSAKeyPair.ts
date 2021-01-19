import { RSA, RSAImpl } from 'crypto/ciphers';
import { HashedObject } from '../model/HashedObject';
import { RSAPublicKey } from './RSAPublicKey';
import { Hashing } from 'data/model/Hashing';

// Note: this classs uses a custom hash function that omits the private key,
//       using only the public part, thus allowing a public key to generate
//       the hash of its corresponding key-pair.

//       Since only the public key is verified by the hash, we also self-sign
//       the private key, a signature that can be verified using the public
//       key (that was hashed).


class RSAKeyPair extends HashedObject {

    static className = 'hhs/v0/RSAKeyPair';

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
        keyPair.initRSA();
        keyPair.selfSign();
        return keyPair;
    }

    format?: string;
    publicKey?: string;
    privateKey?: string;
    privateKeySignature?: string;

    _rsa?: RSA;

    constructor() {
        super();
    }

    init() {
        this.initRSA();
        if (!this.checkSelfSignature()) {
            throw new Error("Self signature check failed for private key");
        }
    }

    validate() {
        this.initRSA();
        return this.checkSelfSignature();
    }

    private initRSA() {
        this._rsa = new RSAImpl();
        this._rsa.loadKeyPair(this.getFormat(), this.getPublicKey(), this.getPrivateKey());
    }

    private selfSign() {
        this.privateKeySignature = this._rsa?.sign(this.privateKey as string);
    }

    private checkSelfSignature() {
        return this.makePublicKey().verifySignature(this.privateKey as string, this.privateKeySignature as string);
    }

    getClassName() {
        return RSAKeyPair.className;
    }

    customHash(seed?: string) {
        return RSAKeyPair.hashPublicKeyPart(this.format as string, this.publicKey as string, seed);
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

    verifySignature(text: string, signature: string) {
        return this._rsa?.verify(text, signature);
    }

    encrypt(plainText: string) {
        return this._rsa?.encrypt(plainText);
    }

    decrypt(cypherText : string) {
        return this._rsa?.decrypt(cypherText);
    }

    static hashPublicKeyPart(format: string, publicKey: string, seed?: string) {
        return Hashing.forValue({'_type': 'custom_hashed_object', '_class': RSAKeyPair.className, '_contents': {'format' : format, 'publicKey': publicKey}}, seed);
    }
}

HashedObject.registerClass(RSAKeyPair.className, RSAKeyPair);

export { RSAKeyPair };