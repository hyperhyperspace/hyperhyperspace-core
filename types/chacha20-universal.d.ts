declare module "chacha20-universal" {

    class ChaCha20 {
        constructor(nonce: Buffer, key: Buffer);
        update(output: Buffer, input: Buffer): void;
        final(): void;
    }

    export default ChaCha20;

}