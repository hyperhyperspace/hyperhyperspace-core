import { HashedObject } from '../model/immutable/HashedObject';

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

    getKeyPair(): RSAKeyPair {

        if (!this.hasKeyPair()) {
            throw new Error('Trying to get key pair, but it is missing from Identity ' + this.hash() + ' (info=' + JSON.stringify(this.info) + ').');
        }

        return this._keyPair as RSAKeyPair;
    }

    getKeyPairIfExists(): RSAKeyPair|undefined {

        try {
            return this.getKeyPair()
        } catch (e) {
            return undefined;
        }
    }

    async sign(text: string) {
        return this.getKeyPair().sign(text);
    }

    decrypt(text: string) {

        if (this._keyPair === undefined) {
            throw new Error('Trying to decrypt using Identity object, but no keyPair has been loaded');
        }

        return this._keyPair.decrypt(text);
    }

    clone(): this {
        const clone = super.clone();
        clone._keyPair = this._keyPair;

        return clone;
    }

}

HashedObject.registerClass(Identity.className, Identity);

export { Identity };