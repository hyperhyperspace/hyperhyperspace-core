
interface EncodingKeyPair {

    generateKey(params: any): Promise<void>;
    loadKeyPair(publicKey: string, privateKey?: string): Promise<void>;

    getPublicKey(): string;
    getPrivateKey(): string | undefined;

    encrypt(plainText: string) : Promise<string>;
    decrypt(cypherText : string) : Promise<string>;
}

export { EncodingKeyPair };