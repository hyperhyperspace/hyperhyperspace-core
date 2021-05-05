import { WebCryptoConfig } from 'crypto/config/WebCryptoConfig';
import { Strings } from 'util/strings';
import { EncodingKeyPair } from './EncodingKeyPair';

const ALGORITHM = 'RSA-OAEP';

class WebCryptoRSAEncKP implements EncodingKeyPair {

    publicKeyPEM?  : string;
    publicKey?     : CryptoKey;

    privateKeyPEM? : string;
    privateKey?     : CryptoKey;

    encoder = new TextEncoder();
    decoder = new TextDecoder();

   async generateKey(params: any): Promise<void> {
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
            ['encrypt', 'decrypt']
        );

        this.privateKey = keyPair.privateKey;

        const exportedPrivKey = await WebCryptoConfig.getSubtle().exportKey("pkcs8", keyPair.privateKey);

        this.privateKeyPEM = '-----BEGIN PRIVATE KEY-----\n' +  
                             (btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(exportedPrivKey)))).match(/.{1,64}/g) as string[]).join('\n') +
                             '\n-----END PRIVATE KEY-----';

        this.publicKey = keyPair.publicKey;

        const exportedPubKey = await WebCryptoConfig.getSubtle().exportKey("spki", keyPair.publicKey);

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
                                        hash: 'SHA-256',
                                    },
                                    true,
                                    ['decrypt']
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
                    ['encrypt']
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

    async encrypt(plainText: string): Promise<string> {

        if (this.publicKey === undefined) {
            throw new Error('Trying to encrypt with WebCrypto, but keypair is uninitialized');
        }

        const cypherBuf = await WebCryptoConfig.getSubtle().encrypt(
            {
                name: ALGORITHM
            },
            this.publicKey,
            this.encoder.encode(plainText)
        );
      
        const cypherUint = new Uint8Array(cypherBuf);
      
        const cypher = Strings.Uint8arrayToBase64(cypherUint);

        return cypher;
    }
    
    async decrypt(cypherText: string): Promise<string> {

        if (this.privateKey === undefined) {
            throw new Error('Trying to decrypt with WebCrypto, but private key is missing');
        }

        const cypherTextRaw = atob(cypherText);
        const cypherTextBuffer = Strings.stingToArrayBuffer(cypherTextRaw);

        const plain = await WebCryptoConfig.getSubtle().decrypt(
                                {name: ALGORITHM },
                                this.privateKey, 
                                cypherTextBuffer);

        return this.decoder.decode(plain);
  }

}

export { WebCryptoRSAEncKP };