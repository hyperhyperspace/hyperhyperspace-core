import { ChaCha20 } from './ChaCha20';

var chacha = require('chacha-js/browser');

import { Strings } from 'util/strings';

type plaintextfmt = "ascii" | "utf8" | "binary";
type ciphertextfmt = "hex" | "base64";

class ChaCha20js implements ChaCha20 {

    encryptHex(message: string, key: string, nonce: string)  {
        let keyBuf = Buffer.from(key, 'hex');
        let nonceBuf = Buffer.from(nonce, 'hex');
        return this.encrypt(message, keyBuf, nonceBuf, 'utf8', 'hex');
    }

    decryptHex(ciphertext: string, key: string, nonce: string) {
        let keyBuf = Buffer.from(key, 'hex');
        let nonceBuf = Buffer.from(nonce, 'hex');
        return this.decrypt(ciphertext, keyBuf, nonceBuf, 'hex', 'utf8');
    }

    encryptBase64(message: string, key: string, nonce: string) {
        let keyBuf = Buffer.from(Strings.base64toHex(key), 'hex');
        let nonceBuf = Buffer.from(Strings.base64toHex(nonce), 'hex');
        return this.encrypt(message, keyBuf, nonceBuf, 'utf8', 'base64');
    }

    decryptBase64(ciphertext: string, key: string, nonce: string) {
        let keyBuf = Buffer.from(Strings.base64toHex(key), 'hex');
        let nonceBuf = Buffer.from(Strings.base64toHex(nonce), 'hex');
        return this.decrypt(ciphertext, keyBuf, nonceBuf, 'base64', 'utf8');
    }

    private encrypt(message: string, key: Buffer, nonce: Buffer, inputFmt: plaintextfmt, outputFmt: ciphertextfmt) : string {
        let cipher = chacha.chacha20(key, nonce);
        let result = cipher.update(message, inputFmt, outputFmt);
        cipher.final();
        return result;
    }

    private decrypt(message: string, key: Buffer, nonce: Buffer, inputFmt: ciphertextfmt, outputFmt: plaintextfmt) : string {

        let decipher = chacha.chacha20(key, nonce);
        let result = decipher.update(message, inputFmt, outputFmt);
        decipher.final();
        return result;
    }

}

export { ChaCha20js };