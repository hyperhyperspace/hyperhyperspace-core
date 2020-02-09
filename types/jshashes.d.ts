declare module "jshashes" {
    namespace Hashes {
        class SHA1  {
            b64: (text: string) => string;
            hex: (text: string) => string;
        }

        class SHA256 {
            b64: (text: string) => string;
            hex: (text: string) => string;
        }

        class SHA512  {
            b64: (text: string) => string;
            hex: (text: string) => string;
        }

        class RMD160 {
            b64: (text: string) => string;
            hex: (text: string) => string;
        }
    }

    export default Hashes;
}