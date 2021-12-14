import { ChaCha20 } from './ChaCha20';

//var chacha = require('chacha20-universal');

import chacha from 'chacha20-universal';

import { Strings } from 'util/strings';

type plaintextfmt = "ascii" | "utf8" | "binary";
type ciphertextfmt = "hex" | "base64";

class ChaCha20Universal implements ChaCha20 {

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
        let cipher = new chacha(nonce, key);
        let input  = Buffer.from(message, inputFmt);
        let output = Buffer.alloc(input.byteLength);
        cipher.update(output, input);
        cipher.final();
        return output.toString(outputFmt);
    }

    private decrypt(message: string, key: Buffer, nonce: Buffer, inputFmt: ciphertextfmt, outputFmt: plaintextfmt) : string {

        let decipher = new chacha(nonce, key);
        let input  = Buffer.from(message, inputFmt);
        let output = Buffer.alloc(input.byteLength);
        decipher.update(output, input);
        decipher.final();
        return output.toString(outputFmt);
    }

}

export { ChaCha20Universal as ChaCha20Universal };