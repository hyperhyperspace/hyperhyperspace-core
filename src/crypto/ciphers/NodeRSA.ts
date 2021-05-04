import { RSA } from './RSA';


class NodeRSA implements RSA {

    generateKey(bits: number): Promise<void> {
        throw new Error('Method not implemented.');
    }

    loadKeyPair(format: string, publicKey: string, privateKey?: string): Promise<void> {
        throw new Error('Method not implemented.');
    }

    getPublicKey(): string {
        throw new Error('Method not implemented.');
    }

    getPrivateKey(): string | undefined {
        throw new Error('Method not implemented.');
    }

    sign(text: string): Promise<string> {
        throw new Error('Method not implemented.');
    }

    verify(text: string, signature: string): Promise<boolean> {
        throw new Error('Method not implemented.');
    }

    encrypt(plainText: string): Promise<string> {
        throw new Error('Method not implemented.');
    }
    
    decrypt(cypherText: string): Promise<string> {
        throw new Error('Method not implemented.');
    }

}

export { NodeRSA };