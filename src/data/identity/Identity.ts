import { RSAKeyPair } from './RSAKeyPair';
import { RSAPublicKey } from './RSAPublicKey';
import { HashedObject } from 'data/model/HashedObject';


class Identity extends HashedObject {

    static className = 'hss/Identity';

    static fromKeyPair(info: object, keyPair: RSAKeyPair) : Identity {
        return Identity.fromPublicKey(info, keyPair.makePublicKey());
    }

    static fromPublicKey(info: object, publicKey: RSAPublicKey) {
        let id = new Identity();

        id.info = info;
        id.publicKey = publicKey;
        
        return id;
    }

    info?: object;
    publicKey?: RSAPublicKey;

    constructor() {
        super();
    }

    init() {
        super.init();
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

}

HashedObject.registerClass(Identity.className, Identity);

export { Identity };