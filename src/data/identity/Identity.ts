import { HashedObject } from '../model/HashedObject';

import { RSAKeyPair } from './RSAKeyPair';
import { RSAPublicKey } from './RSAPublicKey';



class Identity extends HashedObject {

    static className = 'hss/Identity';

    static fromKeyPair(info: object, keyPair: RSAKeyPair) : Identity {
        let id = Identity.fromPublicKey(info, keyPair.makePublicKey());
        id.addKeyPair(keyPair);
        return id;
    }

    static fromPublicKey(info: object, publicKey: RSAPublicKey) {
        let id = new Identity();

        id.info = info;
        id.publicKey = publicKey;
        
        return id;
    }

    info?: object;
    publicKey?: RSAPublicKey;

    _keyPair?: RSAKeyPair;

    constructor() {
        super();
    }

    init() {
        
    }

    getClassName() {
        return Identity.className;
    }

    verify(text: string, signature: string) {
        //text; signature; return true; // mock
        return this.publicKey?.verify(text, signature);
    }

    encrypt(text: string) {
        // return text; // mock
        return this.publicKey?.encrypt(text);
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