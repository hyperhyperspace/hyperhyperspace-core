import { RSA, RSADefaults } from 'crypto/ciphers';
import { HashedObject } from '../model/immutable/HashedObject';
import { RSAPublicKey } from './RSAPublicKey';
import { Hashing } from 'data/model/hashing/Hashing';

// Note: this classs uses a custom hash function that omits the private key,
//       using only the public part, thus allowing a public key to generate
//       the hash of its corresponding key-pair.

//       Since only the public key is verified by the hash, we also self-sign
//       the private key, a signature that can be verified using the public
//       key (that was hashed).


class RSAKeyPair extends HashedObject {

    static className = 'hhs/v0/RSAKeyPair';

    static async generate(bits: number) {
        let rsa = new RSADefaults.impl();
        await rsa.generateKey(bits);

        return RSAKeyPair.fromKeys(rsa.getPublicKey(), rsa.getPrivateKey());
    }

    static async fromKeys(publicKey: string, privateKey?: string) {
        let keyPair = new RSAKeyPair();
        keyPair.publicKey = publicKey;
        keyPair.privateKey = privateKey;
        keyPair.init();
        await keyPair.selfSign();
        return keyPair;
    }

    publicKey?: string;
    privateKey?: string;
    privateKeySignature?: string;

    _rsaPromise?: Promise<RSA>;

    constructor() {
        super();
    }

    init() {
        this._rsaPromise = this.initRSA();
    }

    async validate() {
        return this.checkSelfSignature();
    }

    private async initRSA(): Promise<RSA> {
        const _rsa = new RSADefaults.impl();
        await _rsa.loadKeyPair(this.getPublicKey(), this.getPrivateKey());
        return _rsa;
    }

    private async selfSign() {

        if (this._rsaPromise === undefined) {
            throw new Error('Attempting to self sign keypair, but RSA has not been initialized.');
        }

        this.privateKeySignature = await (await this._rsaPromise).sign(this.privateKey as string);
    }

    private checkSelfSignature() {
        return this.makePublicKey().verifySignature(this.privateKey as string, this.privateKeySignature as string);
    }

    getClassName() {
        return RSAKeyPair.className;
    }

    customHash(seed?: string) {
        return RSAKeyPair.hashPublicKeyPart(this.publicKey as string, seed);
    }

    getPublicKey() {
        return this.publicKey as string;
    }

    getPrivateKey() {
        return this.privateKey as string;
    }

    makePublicKey() {
        return RSAPublicKey.fromKeys(this.getPublicKey());
    }

    async sign(text: string) {

        if (this._rsaPromise === undefined) {
            throw new Error('Attempting to create signature, but RSA has not been initialized.');
        }

        return (await this._rsaPromise).sign(text);
    }

    async verifySignature(text: string, signature: string) {

        if (this._rsaPromise === undefined) {
            throw new Error('Attempting to verify signature, but RSA has not been initialized.');
        }

        return (await this._rsaPromise).verify(text, signature);
    }

    async encrypt(plainText: string) {

        if (this._rsaPromise === undefined) {
            throw new Error('Attempting to encrypt, but RSA has not been initialized.');
        }

        return (await this._rsaPromise).encrypt(plainText);
    }

    async decrypt(cypherText : string) {

        if (this._rsaPromise === undefined) {
            throw new Error('Attempting to decrypt, but RSA has not been initialized.');
        }

        return (await this._rsaPromise).decrypt(cypherText);
    }

    static hashPublicKeyPart(publicKey: string, seed?: string) {
        return Hashing.forValue({'_type': 'custom_hashed_object', '_class': RSAKeyPair.className, '_contents': {'publicKey': publicKey}}, seed);
    }
}

HashedObject.registerClass(RSAKeyPair.className, RSAKeyPair);

export { RSAKeyPair };