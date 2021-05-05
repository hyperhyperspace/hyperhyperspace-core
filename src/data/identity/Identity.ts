import { HashedObject } from '../model/HashedObject';

import { RSAKeyPair } from './RSAKeyPair';
import { RSAPublicKey } from './RSAPublicKey';



class Identity extends HashedObject {

    static className = 'hhs/v0/Identity';

    static fromKeyPair(info: any, keyPair: RSAKeyPair) : Identity {
        let id = Identity.fromPublicKey(info, keyPair.makePublicKey());
        id.addKeyPair(keyPair);
        return id;
    }

    static fromPublicKey(info: any, publicKey: RSAPublicKey) {
        let id = new Identity();

        id.info = info;
        id.publicKey = publicKey;
        
        return id;
    }

    info?: any;
    publicKey?: RSAPublicKey;

    _keyPair?: RSAKeyPair;

    constructor() {
        super();
    }

    init() {
        
    }

    async validate() {
        return true;
    }

    getClassName() {
        return Identity.className;
    }

    verifySignature(text: string, signature: string) {
        
        if (this.publicKey === undefined) {
            throw new Error('Cannot verify signature, Identity is uninitialized')
        }

        return this.publicKey.verifySignature(text, signature);
    }

    encrypt(text: string) {

        if (this.publicKey === undefined) {
            throw new Error('Cannot ecnrypt, Identity is uninitialized')
        }

        return this.publicKey.encrypt(text);
    }

    getPublicKey() {
        return this.publicKey as RSAPublicKey;
    }

    getKeyPairHash() {
        return this.getPublicKey().getKeyPairHash();
    }

    addKeyPair(keyPair: RSAKeyPair) {
        if (keyPair.hash() !== this.getKeyPairHash()) {
            throw new Error('Trying to add key pair to identity, but it does not match identity public key');
        }

        this._keyPair = keyPair;
    }

    hasKeyPair() {
        return this._keyPair !== undefined;
    }

    sign(text: string) {

        if (this._keyPair === undefined) {
            throw new Error('Trying to sign using Identity object, but no keyPair has been loaded');
        }

        return this._keyPair.sign(text);
    }

    decrypt(text: string) {

        if (this._keyPair === undefined) {
            throw new Error('Trying to decrypt using Identity object, but no keyPair has been loaded');
        }

        return this._keyPair.decrypt(text);
    }

}

HashedObject.registerClass(Identity.className, Identity);

export { Identity };