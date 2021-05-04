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

    static async generate(bits: number) {
        let rsa = new RSAImpl();
        rsa.generateKey(bits);

        return RSAKeyPair.fromKeys(rsa.getFormat(), rsa.getPublicKey(), rsa.getPrivateKey());
    }

    static async fromKeys(format: string, publicKey: string, privateKey: string) {
        let keyPair = new RSAKeyPair();
        keyPair.format = format;
        keyPair.publicKey = publicKey;
        keyPair.privateKey = privateKey;
        await keyPair.initRSA();
        await keyPair.selfSign();
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

    async init() {
        this.initRSA();
        if (!this.checkSelfSignature()) {
            throw new Error("Self signature check failed for private key");
        }
    }

    async validate() {
        await this.initRSA();
        return this.checkSelfSignature();
    }

    private async initRSA() {
        this._rsa = new RSAImpl();
        this._rsa.loadKeyPair(this.getFormat(), this.getPublicKey(), this.getPrivateKey());
    }

    private async selfSign() {

        if (this._rsa === undefined) {
            throw new Error('Attempting to self sign keypair, but RSA has not been initialized.');
        }

        this.privateKeySignature = await this._rsa.sign(this.privateKey as string);
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

        if (this._rsa === undefined) {
            throw new Error('Attempting to create signature, but RSA has not been initialized.');
        }

        return this._rsa.sign(text);
    }

    verifySignature(text: string, signature: string) {
        return this._rsa?.verify(text, signature);
    }

    encrypt(plainText: string) {

        if (this._rsa === undefined) {
            throw new Error('Attempting to encrypt, but RSA has not been initialized.');
        }

        return this._rsa.encrypt(plainText);
    }

    decrypt(cypherText : string) {

        if (this._rsa === undefined) {
            throw new Error('Attempting to decrypt, but RSA has not been initialized.');
        }

        return this._rsa?.decrypt(cypherText);
    }

    static hashPublicKeyPart(format: string, publicKey: string, seed?: string) {
        return Hashing.forValue({'_type': 'custom_hashed_object', '_class': RSAKeyPair.className, '_contents': {'format' : format, 'publicKey': publicKey}}, seed);
    }
}

HashedObject.registerClass(RSAKeyPair.className, RSAKeyPair);

export { RSAKeyPair };