//import { JSEncrypt } from 'jsencrypt';
import { RSA } from './RSA';
import { SHA, SHAImpl } from '../hashing';

// dummy objects for JSEncrypt

let fixNavigator = false;

if ((global as any).navigator === undefined) {
    (global as any).navigator = {appName: 'nodejs'};
    fixNavigator = true;
}

let fixWindow = false;

if ((global as any).window === undefined) {
    (global as any).window = {};
    fixWindow = true;
}


const JSEncrypt = require('jsencrypt').JSEncrypt;


if (fixNavigator) {
    (global as any).navigator = undefined;
}

if (fixWindow) {
    (global as any).window = undefined;
}


class JSEncryptRSA implements RSA {

    static PKCS8 = 'pkcs8';

    private crypto? : typeof JSEncrypt;
    private sha : SHA;

    constructor(sha?: SHA) {

        if (sha === undefined) {
            this.sha = new SHAImpl();
        } else {
            this.sha = sha;
        }
    }

    generateKey(bits: number) {
        this.crypto = new JSEncrypt({default_key_size : bits.toString()});
        this.crypto.getKey();
    };

    loadKeyPair(format: string, publicKey: string, privateKey?: string) {

        if (format !== JSEncryptRSA.PKCS8) {
            throw new Error("Currently only pkcs8 encoded RSA keys are supported, sorry");
        }

        this.crypto = new JSEncrypt();
        this.crypto.setPublicKey(publicKey);
        if (privateKey !== undefined) {
            this.crypto.setPrivateKey(privateKey);
        }
    }

    getPublicKey() {
        if (this.crypto === undefined) {
            throw new Error("RSA key pair initialization is missing, attempted to get public key");
        } else {
            return this.crypto.getPublicKey();
        }
    }

    getPrivateKey() {
        if (this.crypto === undefined) {
            throw new Error("RSA key pair initialization is missing, attempted to get private key");
        } else {
            return this.crypto.getPrivateKey();
        }
    }

    getFormat() {
        return 'pkcs8';
    }

    sign(text: string) {
        if (this.crypto === undefined) {
            throw new Error("RSA key pair initialization is missing, attempted to sign");
        } else {
            return this.crypto.sign(text, this.sha.sha256heximpl(), 'sha256');
        }
        
    };

    verify(text: string, signature: string) {
        if (this.crypto === undefined) {
            throw new Error("RSA key pair initialization is missing, attempted to verify");
        } else {
            return this.crypto.verify(text, signature, this.sha.sha256heximpl());
        }
        
    };

    encrypt(plainText: string) {
        if (this.crypto === undefined) {
            throw new Error("RSA key pair initialization is missing, attempted to encrypt");
        } else {
            return this.crypto.encrypt(plainText);
        }
    };

    decrypt(cypherText : string) {
        if (this.crypto === undefined) {
            throw new Error("RSA key pair initialization is missing, attempted to decrypt");
        } else {
            return this.crypto.decrypt(cypherText);
        }
    };

}

export { JSEncryptRSA };