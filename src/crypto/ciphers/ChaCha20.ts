interface ChaCha20 {

    encryptHex(message: string, key: string, nonce: string) : string;
    decryptHex(message: string, key: string, nonce: string) : string;

    encryptBase64(message: string, key: string, nonce: string) : string;
    decryptBase64(message: string, key: string, nonce: string) : string;

}

export { ChaCha20 };