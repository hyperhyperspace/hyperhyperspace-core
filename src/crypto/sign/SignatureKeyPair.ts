

interface SignatureKeyPair {

    generateKey(params: any): Promise<void>;
    loadKeyPair(publicKey?: string, privateKey?: string): Promise<void>;

    getPublicKey(): string;
    getPrivateKey(): string | undefined;
    
    sign(text: string): Promise<string>;
    verify(text: string, signature: string): Promise<boolean>;

}

export { SignatureKeyPair };