
interface RSA {

    generateKey(bits: number) : void;
    loadKeyPair(format: string, publicKey: string, privateKey?: string) : void;

    getPublicKey()  : string;
    getPrivateKey() : string | undefined;
    getFormat()     : string;

    sign(text: string) : string;
    verify(text: string, signature: string) : boolean;

    encrypt(plainText: string) : string;
    decrypt(cypherText : string) : string;

}

export { RSA };