
if (globalThis.TextEncoder === undefined || globalThis.TextDecoder === undefined) {
    require('fast-text-encoding');
}

class WebCryptoConfig {

    static overrideImpl: SubtleCrypto | undefined;

    static getSubtle(): SubtleCrypto {
        if (WebCryptoConfig.overrideImpl !== undefined) {
            return WebCryptoConfig.overrideImpl;
        } else {
            return globalThis.crypto.subtle;
        }
    }

}

export { WebCryptoConfig };