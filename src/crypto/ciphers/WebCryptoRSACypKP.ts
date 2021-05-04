import { Strings } from 'util/strings';
import { CypherKeyPair } from './CypherKeyPair';

const ALGORITHM = 'RSA-OAEP';

class WebCryptoRSACypKP implements CypherKeyPair {

    publicKeyPEM?  : string;
    publicKey?     : CryptoKey;

    privateKeyPEM? : string;
    privateKey?     : CryptoKey;

    encoder = new TextEncoder();
    decoder = new TextDecoder();

   async generateKey(params: any): Promise<void> {
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
            ['encrypt', 'decrypt']
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
                                        hash: 'SHA-256',
                                    },
                                    true,
                                    ['decrypt']
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
                    ['encrypt']
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

    async encrypt(plainText: string): Promise<string> {

        if (this.publicKey === undefined) {
            throw new Error('Trying to encrypt with WebCrypto, but keypair is uninitialized');
        }

        const cypherBuf = await window.crypto.subtle.encrypt(
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

        const plain2 = await window.crypto.subtle.decrypt(
                                {name: ALGORITHM },
                                this.privateKey, 
                                cypherTextBuffer);

        return this.decoder.decode(plain2);
  }

}

export { WebCryptoRSACypKP };