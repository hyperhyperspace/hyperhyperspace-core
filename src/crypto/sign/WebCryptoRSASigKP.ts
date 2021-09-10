import { WebCryptoConfig } from 'crypto/config/WebCryptoConfig';
import { Strings } from 'util/strings';
import { SignatureKeyPair } from './SignatureKeyPair';

const ALGORITHM = 'RSASSA-PKCS1-v1_5';

class WebCryptoRSASigKP implements SignatureKeyPair {

    publicKeyPEM?  : string;
    publicKey?     : CryptoKey;

    privateKeyPEM? : string;
    privateKey?     : CryptoKey;
    
    async generateKey(params?: {b?: number}): Promise<void> {

        const modulusLength = params?.b || 2048;
        const hash          = 'SHA-256';

        const keyPair = await WebCryptoConfig.getSubtle().generateKey(
            {
              name: ALGORITHM,
              // Consider using a 4096-bit key for systems that require long-term security
              modulusLength: modulusLength,
              publicExponent: new Uint8Array([1, 0, 1]),
              hash: hash,
            },
            true,
            ['sign', 'verify']
        );

        this.privateKey = keyPair.privateKey;

        const exportedPrivKey = await WebCryptoConfig.getSubtle().exportKey("pkcs8", keyPair.privateKey as CryptoKey);

        this.privateKeyPEM = '-----BEGIN PRIVATE KEY-----\n' +  
                             (btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(exportedPrivKey)))).match(/.{1,64}/g) as string[]).join('\n') +
                             '\n-----END PRIVATE KEY-----';

        this.publicKey = keyPair.publicKey;

        const exportedPubKey = await WebCryptoConfig.getSubtle().exportKey("spki", keyPair.publicKey as CryptoKey);

        this.publicKeyPEM = '-----BEGIN PUBLIC KEY-----\n' +  
                            (btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(exportedPubKey)))).match(/.{1,64}/g) as string[]).join('\n') +
                            '\n-----END PUBLIC KEY-----';
        
    }

    async loadKeyPair(publicKeyPEM: string, privateKeyPEM?: string): Promise<void> {

        if (privateKeyPEM !== undefined) {
            const privPEMHeader = '-----BEGIN PRIVATE KEY-----';
            const privPEMFooter = '-----END PRIVATE KEY-----';
            const privPEMNoNewlines = privateKeyPEM.replace(/\r?\n|\r/g, '');
            const privPEMContents = privPEMNoNewlines.substring(privPEMHeader.length, privPEMNoNewlines.length - privPEMFooter.length);

            const binaryDerString = atob(privPEMContents);
            const binaryDer = Strings.stingToArrayBuffer(binaryDerString);

            const privateKey = await WebCryptoConfig.getSubtle().importKey(
                                    'pkcs8',
                                    binaryDer,
                                    {
                                        name: ALGORITHM,
                                        hash: {name: 'SHA-256'},
                                    },
                                    true,
                                    ['sign']
                                );

            this.privateKeyPEM = privateKeyPEM;
            this.privateKey = privateKey;            
        }

        const pemHeader = '-----BEGIN PUBLIC KEY-----';
        const pemFooter = '-----END PUBLIC KEY-----';
        const pemNoNewlines = publicKeyPEM.replace(/\r?\n|\r/g, '');
        const pemContents = pemNoNewlines.substring(pemHeader.length, pemNoNewlines.length - pemFooter.length);
        
        const binaryDerString = atob(pemContents);
        const binaryDer = Strings.stingToArrayBuffer(binaryDerString);

        const publicKey = await WebCryptoConfig.getSubtle().importKey(
                    'spki',
                    binaryDer,
                    {
                        name: ALGORITHM,
                        hash: {name : 'SHA-256'}
                    },
                    true,
                    ['verify']
                );

        this.publicKeyPEM = publicKeyPEM;
        this.publicKey    = publicKey;

    
    }

    getPublicKey(): string {
        if (this.publicKeyPEM === undefined) {
            throw new Error('Attempted to export public key, but WebCrypto keypair is uninitialized.');
        }

        return this.publicKeyPEM;
    }

    getPrivateKey(): string | undefined {
        if (this.publicKeyPEM === undefined) {
            throw new Error('Attempted to export private key, but WebCrypto keypair is uninitialized.');
        }

        return this.privateKeyPEM;
    }

    async sign(text: string): Promise<string> {

        if (this.privateKey === undefined) {
            throw new Error('Attempted to export public key, but WebCrypto keypair is uninitialized.');
        }

        const signBuffer = await WebCryptoConfig.getSubtle().sign(
            {
                name: "RSASSA-PKCS1-v1_5",
            },
            this.privateKey, 
            new TextEncoder().encode(text)
        );

        const sign = Strings.Uint8arrayToBase64(new Uint8Array(signBuffer));

        return sign;
    }

    verify(text: string, signature: string): Promise<boolean> {

        if (this.publicKey === undefined) {
            throw new Error('Trying to verify signature with WebCrypto, but keypair is uninitialized');
        }

        let enc = new TextEncoder();

        return WebCryptoConfig.getSubtle().verify({name: ALGORITHM}, this.publicKey, Strings.base64ToUint8array(signature), enc.encode(text));
    }

}

export { WebCryptoRSASigKP };