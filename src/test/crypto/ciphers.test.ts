import { RSA, RSAImpl } from 'crypto/ciphers';
import { ChaCha20, ChaCha20Impl } from 'crypto/ciphers';

describe('Ciphers', () => {
    test('chacha20 self test', () => {
        let chacha = new ChaCha20Impl() as ChaCha20;
        
        let message = 'hey dude, dont make it bad';
        let key   = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
        let nonce = "000102030405060708090a0b";

        let cipher = chacha.encryptHex(message, key, nonce);
        expect(chacha.decryptHex(cipher, key, nonce)).toEqual(message);

        let wrongKey = "ff0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
        expect(chacha.decryptHex(cipher, wrongKey, nonce)).not.toEqual(message);


        let wrongNonce = "ff0102030405060708090a0b";
        expect(chacha.decryptHex(cipher, key, wrongNonce)).not.toEqual(message);
    });

    test('chacha20 encrypt test', () => {
        let chacha = new ChaCha20Impl() as ChaCha20;
        let key = "00000000000000000000000000000000" +
                  "00000000000000000000000000000000"; 
        let nonce = "000000000000000000000000";
        let message = Buffer.from("00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", "hex").toString();
        expect(chacha.encryptHex(message, key, nonce)).toEqual("76b8e0ada0f13d90405d6ae55386bd28bdd219b8a08ded1aa836efcc8b770dc7da41597c5157488d7724e03fb8d84a376a43b8f41518a11cc387b669b2ee6586");
    });

    test('RSA self test', () => {

        let privateKey = 
    "-----BEGIN RSA PRIVATE KEY-----\n" +
    "MIIEogIBAAKCAQB52EypOvlrF6ou80w6qDshC7+8/8mEAzVJXk1NTZamn9WRu9QV\n" +
    "4P34/4pdZ6y2CplHmpUeUpjvXE/I1P8tr+NAR7zE/7XugQBJTWreN69he3jephMT\n" +
    "sBaK2WVvuR/El6JWricvrFqXb9LeeZZ//R87vlCxj1OjkRQJ01zahUqtutuhcvZk\n" +
    "WtT7L2bjlGlziGQ+TkZeUqqLEcf8n0/jivcZWjVspxcTRaa5FZ+4jPnNhQrx+lgX\n" +
    "jgp7nj1SCCx0arNGQUp1jlfblqEeEtYjJNoSFgXJuWhNEMa63Uk0WoHIRJ8L3ZaA\n" +
    "UDolHDF8oOFSXHk0fc9LR1cUCiTMB8hU3q1vAgMBAAECggEASoEyz0Bah1ufGrp2\n" +
    "4F9CWMCga+dUx75WdRiO2DgbaKPPqh9aXk6Hvhwz9U2R1HbCp4Aksrf7AFJIDxv/\n" +
    "NWaZ5RJ4oVVjYAXNsQT/1gXi3g7sJ+kRPTatchXg6uIeRM4b3Dj9iS8w7ezY2mUq\n" +
    "2/Rhhtym5wwnLptlz2RJIO3kbjo7R8KnK193qidC7MrFfV1zpiQs4HIZK/RenSwV\n" +
    "Q7OYfazk6v0r9gSUDNuzVU1tX4IWI8UJpeCGpCgK9GMVempoMy4eHM0Y1RRl2st1\n" +
    "m4RfS+Mac/OmtbhLIOO9OJekDunE0CWpbqvTMe24g91C95+A9myrZTZcTR4nJlus\n" +
    "xYukIQKBgQDQ/HHe/uN3AtUn8wWnakBArDmZeH7/Hr6+0yKPzZA8IXxu7slNbKdk\n" +
    "Mi9P8QXXZ4H923RuOJ4nzXN4WHhWS/s99++q5onJEsJOrV1slp3f7oiLYQVuTSOD\n" +
    "83NSjoadG0qNh9U7Fuk1ViXWapdoCcSGWYPbYN5JEzQp6fSodkq+pwKBgQCVQV/m\n" +
    "Gt+xNeczWeaUtHDTP4vsZ7SCsRb1K4Oo2NbKCUWKi7PcxPvy0Z4PYU/l2GbzprJk\n" +
    "TQelbRR0bg52xddGaBLvJkg/0ApIjngb1jv2PYzMgM+1ts0fdSDrmBZtrFBFtS4m\n" +
    "+bQS6kW4PQSjlJjdZDw2UK/M78OENoVtagd7+QKBgCdl4AW9IZ63Dv44B3HXSwOm\n" +
    "NDmliLOJ1UXeQd7ATxe27GFxbMvG1wvBlj/I3WQNZGk6LQn2bIJubf1bGFyUeGnn\n" +
    "Sux6B7G7cpwofLtS7bJgoqc8BC0WJ8Lha3U930zQ704dNGquWAqxEfMJJz/6z2zQ\n" +
    "hVYfPeii0Suxqmjz3AVzAoGAH04xASCN3quBrOGkXXhjWcuwW4t87xSZzh6sZNPm\n" +
    "aUX8kgyvUxT2C34v+uXcTkdPgLdsH2GQwv/YFHupCPyCJMBbiFGtQcUvAvzu8FfF\n" +
    "B+btC0/RQTnwWDLHDuM9gQ9tXtGbto0VWgpNSVFzEaRvU7BceL//v6pihe6xmbtt\n" +
    "inECgYEAs4N+p+kxs/tNJAvxOqsBHbPUldEsmXht+uagxaUArJP/GLznN+734Ryw\n" +
    "L/8wfTF3JOudCCV0lYoqYj/0YNj3QeKtUL8I9Myg3ZEV9r312hlpY1dHybqbAWvs\n" +
    "9bjGylKvu7UzCcQNuSGPFnpPOR28jSppYVSC5npgo6Yup0kNpv8=\n" +
    "-----END RSA PRIVATE KEY-----\n";

        let publicKey = 
    "-----BEGIN PUBLIC KEY-----\n" +
    "MIIBITANBgkqhkiG9w0BAQEFAAOCAQ4AMIIBCQKCAQB52EypOvlrF6ou80w6qDsh\n" +
    "C7+8/8mEAzVJXk1NTZamn9WRu9QV4P34/4pdZ6y2CplHmpUeUpjvXE/I1P8tr+NA\n" +
    "R7zE/7XugQBJTWreN69he3jephMTsBaK2WVvuR/El6JWricvrFqXb9LeeZZ//R87\n" +
    "vlCxj1OjkRQJ01zahUqtutuhcvZkWtT7L2bjlGlziGQ+TkZeUqqLEcf8n0/jivcZ\n" +
    "WjVspxcTRaa5FZ+4jPnNhQrx+lgXjgp7nj1SCCx0arNGQUp1jlfblqEeEtYjJNoS\n" +
    "FgXJuWhNEMa63Uk0WoHIRJ8L3ZaAUDolHDF8oOFSXHk0fc9LR1cUCiTMB8hU3q1v\n" +
    "AgMBAAE=\n" +
    "-----END PUBLIC KEY-----";


        let rsa = new RSAImpl() as RSA;
        rsa.loadKeyPair(RSAImpl.PKCS8, publicKey, privateKey);

        let rsaPublic = new RSAImpl() as RSA;
        rsaPublic.loadKeyPair(RSAImpl.PKCS8, publicKey);

        let message = 'this is a small text message';

        let ciphertext = rsaPublic.encrypt(message);
        expect(rsa.decrypt(ciphertext)).toEqual(message);

        let signature = rsa.sign(message);
        expect(rsaPublic.verify(message, signature)).toEqual(true);

        let wrongSignature = "NU6k7ilRspYc6O7fUvGOnPdS7VkW3e1nYsrz6MflCUSNffTCpH/tS3J+2fvICWqN9dkCYXE/La969Gsod5nIPbonxvzNHpJKW/7Dnn2q62AN+k3ZFOGJ17qLrAu1mg9bcu4B0m3cbwrNLdUV1MBWp4poQI5bn8uM+A1IkdOLOFyyeWSgrlWstc2RvTnZlKR5Dk4F/kZMh4tzfC3sbktlirk7IbT0HvlU4V2hpu6lx3uw2wRbvH8CGTavToQeBI/StPh98JDZcdaB7nfWYZ2MIBwt9NpXQvcoaUuee4T7UkynIgYngmnmZnD/X9/WP0kO7tWa89I6uOVsiWowOBYsew==";
        expect(rsaPublic.verify(message, wrongSignature)).toEqual(false);
    });

    test('RSA encrpyt test', () => {

        // UNFINISHED

        let private_key = 
"-----BEGIN OPENSSH PRIVATE KEY-----\n" +
"b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABFwAAAAdzc2gtcn\n" +
"NhAAAAAwEAAQAAAQEAxd1a3bbNy4B22fXBhUXayVxWIf8HH7hjbQmlUAo/GA+eFDuIT+Bl\n" +
"q/XehjpZJsgbk2k3QLM3yP0ckqDdIEe7BdX8QU2vuh3q4KoZOZ5bg5Qf6d4YR7wq0M1l+Z\n" +
"G6zgIckzRfWQxDGy8CkNAbWSgxOAvjvNBb2iKJOkwCTOaPGn+iJ4L4xELqDKTGH3p/YyLs\n" +
"j4abNasGNFX2UNxNKJ9zixZ3Sy17Ft0rvGze7PEv3kUjdYpi+r3aPsZA+KIywd8skf101M\n" +
"OMXBFuT/2gh5HMG4n2OgozIRN/FCJeT05BnSVAl62wCmIM/Yso6giKxXziN2TYd6MzynwH\n" +
"mrRST8xRpwAAA9gywmqUMsJqlAAAAAdzc2gtcnNhAAABAQDF3Vrdts3LgHbZ9cGFRdrJXF\n" +
"Yh/wcfuGNtCaVQCj8YD54UO4hP4GWr9d6GOlkmyBuTaTdAszfI/RySoN0gR7sF1fxBTa+6\n" +
"Hergqhk5nluDlB/p3hhHvCrQzWX5kbrOAhyTNF9ZDEMbLwKQ0BtZKDE4C+O80FvaIok6TA\n" +
"JM5o8af6IngvjEQuoMpMYfen9jIuyPhps1qwY0VfZQ3E0on3OLFndLLXsW3Su8bN7s8S/e\n" +
"RSN1imL6vdo+xkD4ojLB3yyR/XTUw4xcEW5P/aCHkcwbifY6CjMhE38UIl5PTkGdJUCXrb\n" +
"AKYgz9iyjqCIrFfOI3ZNh3ozPKfAeatFJPzFGnAAAAAwEAAQAAAQAY2PFeQmSZl6pVOL1y\n" +
"pRESlFvkrQgR/a/Os5Vk9cRymxN46vj1PvLFo3ysUot7iUmdO2tK3ra0sMRzzWu3cAqWcw\n" +
"bYlI7qynMCf5nnWHGZlnJjhhZ6e7DMw954dsqEsFMyUTNgFWAf+8lQsjGdAqUbqrKQtYGz\n" +
"ZP7iqUTor1NtOj02RfMJ5ooHdwyRCDwGJyAS7nC9H/AxlpTLkz8T6so6aQ/Hkox29GNaWB\n" +
"tVmD9hpYTbkQ5GjDhwLOUYeO0Cnj4NSGMqaU1gCR/tVOztWhsfTN6u2/sCOk0E6lZm6GGF\n" +
"UlMQUZEVDKMsL5ClIuTFbRxvgBeLzGyppPonfTt2iHuhAAAAgQDmdp/DMeCJTB7qRRjvf6\n" +
"oH+QzQH0ABEz+YgoHbcn51CVci5jUkM09+aTt9rAh5OYPcsRQluzDniZ4KdDAzlS1lg7CA\n" +
"hBmnXrmRjDqv6VWTwBaKHvyknFddu2OhufdXXv3Va907H7oA9sDjlJkaC4sOR6b/XZbW+/\n" +
"2GTofmeyuR9AAAAIEA9y9hMfO4p8yCRDGS7803G/RvUddpH3gxEs9CULvFdFUuseXRyMmm\n" +
"XLMU+niwwPdKkbomMLcbEEb9aSaP5Es9XNHD5rueU0npe7MtLdgBxj6uPaYJ7NyI7v5n1X\n" +
"qw4FRFhd/Ovapo4fZ3dN8yZLZ5uSv6nIxroAF1WUnvxxf0QUkAAACBAMzrtzrX9NRCttGO\n" +
"sjZ8oKgKzoJt+dHIz6Wpye5EWySvzLQE65chc/P3oT/qB+o1Zj3WVOWxvBQMpWe8PBEDQM\n" +
"2Wl3r5dxmM4jW5d5oehABYKVyDfpFZtvFobXnMgL/a84AoRG6ndoRmXKbE/MjrDsxUnxTK\n" +
"jpjCkTtlgNQDRutvAAAAIGd1Y2hAU2FudGlhZ29zLU1hY0Jvb2stUHJvLmxvY2FsAQI=\n" +
"-----END OPENSSH PRIVATE KEY-----";

        let public_key = "-----BEGIN PUBLIC KEY-----\n" + 
        "AAAAB3NzaC1yc2EAAAADAQABAAABAQDF3Vrdts3LgHbZ9cGFRdrJXFYh/wcfuGNtCaVQCj8YD54UO4hP4GWr9d6GOlkmyBuTaTdAszfI/RySoN0gR7sF1fxBTa+6Hergqhk5nluDlB/p3hhHvCrQzWX5kbrOAhyTNF9ZDEMbLwKQ0BtZKDE4C+O80FvaIok6TAJM5o8af6IngvjEQuoMpMYfen9jIuyPhps1qwY0VfZQ3E0on3OLFndLLXsW3Su8bN7s8S/eRSN1imL6vdo+xkD4ojLB3yyR/XTUw4xcEW5P/aCHkcwbifY6CjMhE38UIl5PTkGdJUCXrbAKYgz9iyjqCIrFfOI3ZNh3ozPKfAeatFJPzFGn\n" +
        "-----END PUBLIC KEY-----";
        
        public_key;
        private_key;

        
        //let rsa = new RSAImpl() as RSA;

        //rsa.generateKey(2048);

        //rsa.loadKeyPair('pkcs8', public_key, private_key);

        //console.log(rsa.getPrivateKey());
        //console.log(rsa.getPublicKey());

        //let rsa2 = new RSAImpl() as RSA;

        //rsa2.loadKeyPair('pkcs8', rsa.getPrivateKey() as string, rsa.getPrivateKey());

    });
});

