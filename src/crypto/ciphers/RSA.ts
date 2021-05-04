
interface RSA {

    generateKey(bits: number) : Promise<void>;
    loadKeyPair(format: string, publicKey: string, privateKey?: string) : Promise<void>;

    getPublicKey()  : string;
    getPrivateKey() : string | undefined;
    
    sign(text: string) : Promise<string>;
    verify(text: string, signature: string) : Promise<boolean>;

    encrypt(plainText: string) : Promise<string>;
    decrypt(cypherText : string) : Promise<string>;

}

export { RSA };