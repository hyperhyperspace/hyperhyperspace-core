import { NodeRSA } from "./NodeRSA";
import { WebCryptoRSA } from "./WebCryptoRSA";

interface RSA {



    generateKey(bits: number) : Promise<void>;
    loadKeyPair(publicKey: string, privateKey?: string) : Promise<void>;

    getPublicKey()  : string;
    getPrivateKey() : string | undefined;
    
    sign(text: string) : Promise<string>;
    verify(text: string, signature: string) : Promise<boolean>;

    encrypt(plainText: string) : Promise<string>;
    decrypt(cypherText : string) : Promise<string>;

}

class RSADefaults {
    static impl: new () => RSA = globalThis?.crypto?.subtle !== undefined? WebCryptoRSA : NodeRSA;
}

export { RSA, RSADefaults };