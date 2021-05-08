
if (globalThis.TextEncoder === undefined || globalThis.TextDecoder === undefined) {
    require('fast-text-encoding');
}

class WebCryptoConfig {

    static overrideImpl: SubtleCrypto | undefined;

    static getSubtle(): SubtleCrypto {
        if ((globalThis as any)?.webCryptoOverrideImpl !== undefined) {
            return (globalThis as any)?.webCryptoOverrideImpl as SubtleCrypto;
        } else {
            return globalThis.crypto.subtle;
        }
    }

}

export { WebCryptoConfig };