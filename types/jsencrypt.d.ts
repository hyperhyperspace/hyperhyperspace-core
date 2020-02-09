declare module "jsencrypt" {

    class JSEncrypt {
        constructor(params?: any);
        getKey(): void;
        setPublicKey(publicKey: string): void;
        setPrivateKey(publicKey: string): void;
        getPublicKey(): string;
        getPrivateKey(): string;
        sign(text: string, hash: (text: string) => string, hashName: string): string;
        verify(text: string, signature: string, hash: (text:string) => string): boolean;
        encrypt(plainText: string): string;
        decrypt(plainText: string): string;
    }

} 