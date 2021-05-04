import { SignatureKeyPair } from 'crypto/sign/SignatureKeyPair';
import { WebCryptoRSASigKP } from 'crypto/sign/WebCryptoRSASigKP';
import { EncodingKeyPair } from './EncodingKeyPair';
import { RSA } from './RSA';
import { WebCryptoRSAEncKP } from './WebCryptoRSAEncKP';


class WebCryptoRSA implements RSA {

    encKeyPair?  : EncodingKeyPair;
    signKeyPair? : SignatureKeyPair;

    async generateKey(bits: number): Promise<void> {
        
        this.signKeyPair = new WebCryptoRSASigKP();
        await this.signKeyPair.generateKey({b: bits});
        
        this.encKeyPair = new WebCryptoRSAEncKP();
        await this.encKeyPair.loadKeyPair(this.signKeyPair.getPublicKey(), this.signKeyPair.getPrivateKey());

    }

    async loadKeyPair(format: string, publicKey: string, privateKey?: string): Promise<void> {
        
        format; // ignore

        this.signKeyPair = new WebCryptoRSASigKP();
        await this.signKeyPair.loadKeyPair(publicKey, privateKey);
        
        this.encKeyPair = new WebCryptoRSAEncKP();
        await this.encKeyPair.loadKeyPair(publicKey, privateKey);

    }

    getPublicKey(): string {

        if (this.signKeyPair === undefined) {
            throw new Error('Trying to retrieve public key from uninitialized WebCrypto RSA KeyPair wrapper.')
        }

        return this.signKeyPair.getPublicKey();
    }

    getPrivateKey(): string | undefined {

        if (this.signKeyPair === undefined) {
            throw new Error('Trying to retrieve private key from uninitialized WebCrypto RSA KeyPair wrapper.')
        }


        return this.signKeyPair.getPrivateKey();
    }

    async sign(text: string): Promise<string> {

        if (this.signKeyPair === undefined) {
            throw new Error('Trying to create signature using uninitialized WebCrypto RSA KeyPair wrapper.')
        }

        return this.signKeyPair?.sign(text);
    }

    async verify(text: string, signature: string): Promise<boolean> {

        if (this.signKeyPair === undefined) {
            throw new Error('Trying to verify signature using uninitialized WebCrypto RSA KeyPair wrapper.')
        }

        return this.signKeyPair.verify(text, signature);
    }

    async encrypt(plainText: string): Promise<string> {

        if (this.encKeyPair === undefined) {
            throw new Error('Trying to encrypt using uninitialized WebCrypto RSA KeyPair wrapper.')
        }

        return this.encKeyPair.encrypt(plainText);
    }

    async decrypt(cypherText: string): Promise<string> {

        if (this.encKeyPair === undefined) {
            throw new Error('Trying to decrypt using uninitialized WebCrypto RSA KeyPair wrapper.')
        }

        return this.encKeyPair.decrypt(cypherText);
    }

}