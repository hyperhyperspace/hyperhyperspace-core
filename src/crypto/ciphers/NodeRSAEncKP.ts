import NodeRSA from 'node-rsa';
import { Strings } from 'util/strings';
import { EncodingKeyPair } from './EncodingKeyPair';

class NodeRSAEncKP implements EncodingKeyPair {

    publicKeyPEM?: string;
    privateKeyPEM?: string;

    keyPair?: NodeRSA;

    encoder = new TextEncoder();
    decoder = new TextDecoder();

    async generateKey(params?: {b?: number}): Promise<void> {
        
        this.keyPair = new NodeRSA();

        this.keyPair.setOptions({
            environment: 'browser',
            encryptionScheme: {
                scheme: 'pkcs1_oaep', //scheme
                hash: 'sha256', //hash using for scheme
            }
        });
        
        this.keyPair.generateKeyPair(params?.b || 2048);


        this.publicKeyPEM  = this.keyPair.exportKey('pkcs8-public-pem');
        this.privateKeyPEM = this.keyPair.exportKey('pkcs8-private-pem');

    }

    async loadKeyPair(publicKey?: string, privateKey?: string): Promise<void> {
        
        if (privateKey !== undefined) {

            this.keyPair = new NodeRSA();

            this.keyPair.setOptions({
                environment: 'browser',
                encryptionScheme: {
                    scheme: 'pkcs1_oaep', //scheme
                    hash: 'sha256', //hash using for scheme
                }
            });

            this.keyPair.importKey(privateKey, 'pkcs8-private-pem');

            this.privateKeyPEM = privateKey;

            if (publicKey === undefined) {
                this.publicKeyPEM = this.keyPair.exportKey('pkcs8-public-pem');
            } else {
                this.publicKeyPEM = publicKey;
            }

        } else if (publicKey !== undefined) {
            this.keyPair = new NodeRSA();

            this.keyPair.setOptions({
                environment: 'browser',
                encryptionScheme: {
                    scheme: 'pkcs1_oaep', //scheme
                    hash: 'sha256', //hash using for scheme
                }
            });

            this.keyPair.importKey(publicKey, 'pkcs8-public-pem');
            
            this.publicKeyPEM  = publicKey;
            this.privateKeyPEM = undefined;
        } else {
            throw new Error('Could not import RSA private key using NodeRSA');
        }

    }

    getPublicKey(): string {
        if (this.publicKeyPEM === undefined) {
            throw new Error('Attempted to export public key, but NodeRSA keypair is uninitialized.');
        }

        return this.publicKeyPEM;
    }

    getPrivateKey(): string | undefined {
        if (this.publicKeyPEM === undefined) {
            throw new Error('Attempted to export private key, but NodeRSA keypair is uninitialized.');
        }

        return this.privateKeyPEM;
    }

    async encrypt(plainText: string): Promise<string> {
        if (this.keyPair === undefined) {
            throw new Error('Attempted to encrypt, but NodeRSA keypair is uninitialized.');
        }

        return this.keyPair.encrypt(Buffer.from(this.encoder.encode(plainText)), 'base64', 'utf8');
    }

    async decrypt(cypherText: string): Promise<string> {
        if (this.keyPair === undefined) {
            throw new Error('Attempted to decrypt, but NodeRSA keypair is uninitialized.');
        }

        return this.decoder.decode(this.keyPair.decrypt(cypherText));
    }
    
}

export { NodeRSAEncKP };