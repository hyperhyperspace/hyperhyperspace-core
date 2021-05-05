import { RSA } from './RSA';
import { SignatureKeyPair } from 'crypto/sign/SignatureKeyPair';
import { EncodingKeyPair } from './EncodingKeyPair';



class DelegatingRSAImpl implements RSA {

    encKeyPair  : EncodingKeyPair;
    signKeyPair : SignatureKeyPair;
    initialized : boolean;

    constructor(encKeyPair: EncodingKeyPair, signKeyPair: SignatureKeyPair) {
        this.encKeyPair = encKeyPair;
        this.signKeyPair = signKeyPair;
        this.initialized = false;
    }

    async generateKey(bits: number): Promise<void> {
        
        await this.signKeyPair.generateKey({b: bits});
        await this.encKeyPair.loadKeyPair(this.signKeyPair.getPublicKey(), this.signKeyPair.getPrivateKey());

        this.initialized = true;

    }

    async loadKeyPair(format: string, publicKey: string, privateKey?: string): Promise<void> {
        
        format; // ignore

        if (this.initialized) {
            throw new Error('RSA key cannot be re-initialized.')
        }

        await this.signKeyPair.loadKeyPair(publicKey, privateKey);        
        await this.encKeyPair.loadKeyPair(publicKey, privateKey);

        this.initialized = true;
    }

    getPublicKey(): string {

        if (!this.initialized) {
            throw new Error('Trying to retrieve public key from uninitialized WebCrypto RSA KeyPair wrapper.')
        }

        return this.signKeyPair.getPublicKey();
    }

    getPrivateKey(): string | undefined {

        if (!this.initialized) {
            throw new Error('Trying to retrieve private key from uninitialized WebCrypto RSA KeyPair wrapper.')
        }


        return this.signKeyPair.getPrivateKey();
    }

    async sign(text: string): Promise<string> {

        if (!this.initialized) {
            throw new Error('Trying to create signature using uninitialized WebCrypto RSA KeyPair wrapper.')
        }

        return this.signKeyPair?.sign(text);
    }

    async verify(text: string, signature: string): Promise<boolean> {

        if (!this.initialized) {
            throw new Error('Trying to verify signature using uninitialized WebCrypto RSA KeyPair wrapper.')
        }

        return this.signKeyPair.verify(text, signature);
    }

    async encrypt(plainText: string): Promise<string> {

        if (!this.initialized) {
            throw new Error('Trying to encrypt using uninitialized WebCrypto RSA KeyPair wrapper.')
        }

        return this.encKeyPair.encrypt(plainText);
    }

    async decrypt(cypherText: string): Promise<string> {

        if (!this.initialized) {
            throw new Error('Trying to decrypt using uninitialized WebCrypto RSA KeyPair wrapper.')
        }

        return this.encKeyPair.decrypt(cypherText);
    }
}

export { DelegatingRSAImpl };