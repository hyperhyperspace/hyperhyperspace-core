import { Cipher, Decipher } from "crypto";

declare function createCipher(key: Buffer, nonce: Buffer) : Cipher;  
declare function createDecipher(key: Buffer, nonce: Buffer) : Decipher;
