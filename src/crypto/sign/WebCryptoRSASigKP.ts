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

        const keyPair = await window.crypto.subtle.generateKey(
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

        if (!(keyPair instanceof CryptoKeyPair)) {
            throw new Error('Could not generate RSA key pair using WebCrypto, params: ' + params);
        }

        this.privateKey = keyPair.privateKey;

        const exportedPrivKey = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

        this.privateKeyPEM = '-----BEGIN PRIVATE KEY-----\n' +  
                             (btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(exportedPrivKey)))).match(/.{1,64}/g) as string[]).join('\n') +
                             '\n-----END PRIVATE KEY-----';

        this.publicKey = keyPair.publicKey;

        const exportedPubKey = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);

        this.publicKeyPEM = '-----BEGIN PUBLIC KEY-----\n' +  
                            (btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(exportedPubKey)))).match(/.{1,64}/g) as string[]).join('\n') +
                            '\n-----END PUBLIC KEY-----';
        
    }

    async loadKeyPair(publicKeyPEM: string, privateKeyPEM?: string): Promise<void> {

        if (privateKeyPEM !== undefined) {
            const privPEMHeader = '-----BEGIN PRIVATE KEY-----';
            const privPEMFooter = '-----END PRIVATE KEY-----';
            const privPEMContents = privateKeyPEM.substring(privPEMHeader.length, privateKeyPEM.length - privPEMFooter.length).replaceAll('\n', '');
  
            const binaryDerString = atob(privPEMContents);
            const binaryDer = str2ab(binaryDerString);

            const privateKey = await window.crypto.subtle.importKey(
                                    'pkcs8',
                                    binaryDer,
                                    {
                                        name: ALGORITHM,
                                        hash: {name: 'SHA-256'},
                                    },
                                    true,
                                    ['sign']
                                );
            
            if (privateKey instanceof CryptoKey) {
                this.privateKeyPEM = privateKeyPEM;
                this.privateKey = privateKey;
            } else {
                throw new Error('Could not import RSA private key using WebCrypto');
            }

        }
        
        const pemHeader = '-----BEGIN PUBLIC KEY-----';
        const pemFooter = '-----END PUBLIC KEY-----';
        const pemContents = publicKeyPEM.substring(pemHeader.length, publicKeyPEM.length - pemFooter.length);
        const binaryDerString = atob(pemContents);
        const binaryDer = str2ab(binaryDerString);

        const publicKey = await window.crypto.subtle.importKey(
                    'spki',
                    binaryDer,
                    {
                        name: ALGORITHM,
                        hash: {name : 'SHA-256'}
                    },
                    true,
                    ['verify']
                );
        if (publicKey instanceof CryptoKey) {
            this.publicKeyPEM = publicKeyPEM;
            this.publicKey    = publicKey;

        } else {
            throw new Error('Could not import RSA public key using WebCrypto');
        }
    
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

        const signBuffer = await window.crypto.subtle.sign(
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

        return crypto.subtle.verify({name: ALGORITHM}, this.publicKey, Strings.base64ToUint8array(signature), enc.encode(text));
    }

}

export { WebCryptoRSASigKP };