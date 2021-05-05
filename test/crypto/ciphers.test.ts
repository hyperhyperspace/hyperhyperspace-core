import { RSA, RSAImpl } from 'crypto/ciphers';
import { ChaCha20, ChaCha20Impl } from 'crypto/ciphers';
import { describeProxy } from 'config';
import { RSADefaults } from 'crypto/ciphers/RSA';
import { WebCryptoRSA } from 'crypto/ciphers/WebCryptoRSA';
import { NodeRSA } from 'crypto/ciphers/NodeRSA';

const privateKey = 
"-----BEGIN PRIVATE KEY-----\n" +
"MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDcl6HjhLeboXhS\n" +
"h+DZa1JhePf5wUYxLdFibd6L5biKpzjuPb1QiYKNWbIdNVuM16j0zzLwd06GFw7O\n" +
"Dr/XVuQQFJedLzb2SLbLfDs6D2FIyLYsDFqYwXzsClUmXpzqq4V9kDtowuAl6YW8\n" +
"WbJ6xTvfz39ieRN3r00etjdF87q2wT1mO6eFjER8KLU5G6GIRNtzCwZ32k9Gpq96\n" +
"x/5BPrqRm4IvGzq3jGHmxAGeP+9/9LmeIboQmXM8vbCW5gmZPWsJbH0fXzioPk3G\n" +
"6Pal11I4Xti342Kl5CKhDFd3LKw7WK0ZSHrcd5622oiXgQWFtXiw+YTYUe5O356E\n" +
"EnTaU/FLAgMBAAECggEAMbbyw0X741VGusLox9dKH7GVoXIPkbHTyK0eRMUnDAiX\n" +
"6gl8CxSSmaynWbHWyi0oZNP1lQAucEXuDj6AudVZXM5nRQOJDYRhvgZnirRAppil\n" +
"hdPa7yZcMw45FoaoMrMpSJ0i5n9U6PZyL3q/oK+myNAI03aaDpUxekRyvI8re1gy\n" +
"kwqYshYAjKDCdEhHveTB2e+TyoyM7K/Funim5pzZwKvWFU3VkO/Q2H9aCX4dnFQH\n" +
"eywnCi7gISbddaJBzXPQEBrAomrequ0NyBRB0Btgde5mDYcW1CdGWwfDvMceo10w\n" +
"14xbalrIa7TnIUi5UrCtU6cDB7jFTEv5bZKy8DUbAQKBgQDuJmCSJNTBUdEeP8ga\n" +
"imh59lkl4cEthKIh5Y8XxTD2b1tga6O2Z6dAlsbkSfqDPxDzZJRodQkmW2RqmLaD\n" +
"9IWSKfUoTbYyfF4i3AV8cvMiB6LbBi9F+cwltdOIg1/2k71iRy0PanPt8v9TY96X\n" +
"S0iQOnHiFYqxGW0Lgwo4hVNaCwKBgQDtIFwcVWds7y5jngGdI7TMRwsk37htECzK\n" +
"sV0RENb0ZUPLFOVjrdj3bo9JekLfioYut/JLOTiO4bZ6BCckljwi/OHpuA0vzrOK\n" +
"rUnYNB5hdgyWSkdK9oRyC84G/vtGTYP+cPSUD2ySqt/oYZFmTNUcPyEnlXmJl3Ut\n" +
"yl0NPc+NwQKBgQC/OBVmgyhJqXYtwazckrHc7A8cua4w7ER6zyYcQftUhIlsXEFx\n" +
"nrzOwcIlX7lEVQk5RVNcpEyafdudM82pGld9yy7ME8nts6qqdtv41xueAV+kWczv\n" +
"dOmUhfC5tjMBfBMerGPj8ufu8aRNwuzhslMra6IxlHZuSSojii5Uv8jzjQKBgAUl\n" +
"JJqAx+O3NNx4ezR7p9qe2AEO0aOcLDyhqJFMOj3HTLdFVszY4tJLldRUUMsk6FBv\n" +
"MVSsgyumfh0bpfXHRLrFnelCUxbsdzzVEbsdNmOK+i7woadgvfLzip7gPXeDCxAk\n" +
"R0pHI2XzSzRxmYQMursIK6H+Pkrb/HDn6Sj2ZGCBAoGBAIfsGm1uWJjFMTIOEFjR\n" +
"UdgKeDxRlxjUfSEAQaT/0puBPl8DPtzHtNPXppo0RjJudFplD0XeiUpe8iEpGmMm\n" +
"M/UIriB8oyEBClTF0Wby+tVSy3Yo68Y+GN1EX/z/rT5V8Kr6Dsc9+zZPfdbyno8Z\n" +
"J2/sabWdFpSVB4v+NDPn8tim\n" +
"-----END PRIVATE KEY-----\n";

    const publicKey = 
"-----BEGIN PUBLIC KEY-----\n" +
"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3Jeh44S3m6F4Uofg2WtS\n" +
"YXj3+cFGMS3RYm3ei+W4iqc47j29UImCjVmyHTVbjNeo9M8y8HdOhhcOzg6/11bk\n" +
"EBSXnS829ki2y3w7Og9hSMi2LAxamMF87ApVJl6c6quFfZA7aMLgJemFvFmyesU7\n" +
"389/YnkTd69NHrY3RfO6tsE9ZjunhYxEfCi1ORuhiETbcwsGd9pPRqavesf+QT66\n" +
"kZuCLxs6t4xh5sQBnj/vf/S5niG6EJlzPL2wluYJmT1rCWx9H184qD5Nxuj2pddS\n" +
"OF7Yt+NipeQioQxXdyysO1itGUh63HeettqIl4EFhbV4sPmE2FHuTt+ehBJ02lPx\n" +
"SwIDAQAB\n" +
"-----END PUBLIC KEY-----\n";

describeProxy('[ENC] Ciphers', () => {
    test('[ENC01] chacha20 self test', () => {
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

    test('[ENC02] chacha20 encrypt test', () => {
        let chacha = new ChaCha20Impl() as ChaCha20;
        let key = "00000000000000000000000000000000" +
                  "00000000000000000000000000000000"; 
        let nonce = "000000000000000000000000";
        let message = Buffer.from("00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", "hex").toString();
        expect(chacha.encryptHex(message, key, nonce)).toEqual("76b8e0ada0f13d90405d6ae55386bd28bdd219b8a08ded1aa836efcc8b770dc7da41597c5157488d7724e03fb8d84a376a43b8f41518a11cc387b669b2ee6586");
    });

    test('[ENC03] RSA self test', async () => {

        let rsa = new RSADefaults.impl() as RSA;
        await rsa.loadKeyPair(RSAImpl.PKCS8, publicKey, privateKey);

        let rsaPublic = new RSADefaults.impl() as RSA;
        await rsaPublic.loadKeyPair(RSAImpl.PKCS8, publicKey);

        let message = '₿₿₿ this is a small text message 😱';

        let ciphertext = await rsaPublic.encrypt(message);

        expect(await rsa.decrypt(ciphertext)).toEqual(message);

        let signature = await rsa.sign(message);
        expect(await rsaPublic.verify(message, signature)).toEqual(true);

        let wrongSignature = "NU6k7ilRspYc6O7fUvGOnPdS7VkW3e1nYsrz6MflCUSNffTCpH/tS3J+2fvICWqN9dkCYXE/La969Gsod5nIPbonxvzNHpJKW/7Dnn2q62AN+k3ZFOGJ17qLrAu1mg9bcu4B0m3cbwrNLdUV1MBWp4poQI5bn8uM+A1IkdOLOFyyeWSgrlWstc2RvTnZlKR5Dk4F/kZMh4tzfC3sbktlirk7IbT0HvlU4V2hpu6lx3uw2wRbvH8CGTavToQeBI/StPh98JDZcdaB7nfWYZ2MIBwt9NpXQvcoaUuee4T7UkynIgYngmnmZnD/X9/WP0kO7tWa89I6uOVsiWowOBYsew==";
        expect(await rsaPublic.verify(message, wrongSignature)).toEqual(false);
    });

    test('[ENC04] RSA self test - force WebCrypto', async () => {

        let rsa = new WebCryptoRSA() as RSA;
        await rsa.loadKeyPair(RSAImpl.PKCS8, publicKey, privateKey);

        let rsaPublic = new WebCryptoRSA() as RSA;
        await rsaPublic.loadKeyPair(RSAImpl.PKCS8, publicKey);

        let message = '₿₿₿ this is a small text message 😱';

        let ciphertext = await rsaPublic.encrypt(message);

        expect(await rsa.decrypt(ciphertext)).toEqual(message);

        let signature = await rsa.sign(message);
        expect(await rsaPublic.verify(message, signature)).toEqual(true);

        let wrongSignature = "NU6k7ilRspYc6O7fUvGOnPdS7VkW3e1nYsrz6MflCUSNffTCpH/tS3J+2fvICWqN9dkCYXE/La969Gsod5nIPbonxvzNHpJKW/7Dnn2q62AN+k3ZFOGJ17qLrAu1mg9bcu4B0m3cbwrNLdUV1MBWp4poQI5bn8uM+A1IkdOLOFyyeWSgrlWstc2RvTnZlKR5Dk4F/kZMh4tzfC3sbktlirk7IbT0HvlU4V2hpu6lx3uw2wRbvH8CGTavToQeBI/StPh98JDZcdaB7nfWYZ2MIBwt9NpXQvcoaUuee4T7UkynIgYngmnmZnD/X9/WP0kO7tWa89I6uOVsiWowOBYsew==";
        expect(await rsaPublic.verify(message, wrongSignature)).toEqual(false);
    });

    test('[ENC05] RSA self test - force NodeRSA', async () => {

        let rsa = new NodeRSA() as RSA;
        await rsa.loadKeyPair(RSAImpl.PKCS8, publicKey, privateKey);

        let rsaPublic = new NodeRSA() as RSA;
        await rsaPublic.loadKeyPair(RSAImpl.PKCS8, publicKey);

        let message = '₿₿₿ this is a small text message 😱';

        let ciphertext = await rsaPublic.encrypt(message);

        expect(await rsa.decrypt(ciphertext)).toEqual(message);

        let signature = await rsa.sign(message);
        expect(await rsaPublic.verify(message, signature)).toEqual(true);

        let wrongSignature = "NU6k7ilRspYc6O7fUvGOnPdS7VkW3e1nYsrz6MflCUSNffTCpH/tS3J+2fvICWqN9dkCYXE/La969Gsod5nIPbonxvzNHpJKW/7Dnn2q62AN+k3ZFOGJ17qLrAu1mg9bcu4B0m3cbwrNLdUV1MBWp4poQI5bn8uM+A1IkdOLOFyyeWSgrlWstc2RvTnZlKR5Dk4F/kZMh4tzfC3sbktlirk7IbT0HvlU4V2hpu6lx3uw2wRbvH8CGTavToQeBI/StPh98JDZcdaB7nfWYZ2MIBwt9NpXQvcoaUuee4T7UkynIgYngmnmZnD/X9/WP0kO7tWa89I6uOVsiWowOBYsew==";
        expect(await rsaPublic.verify(message, wrongSignature)).toEqual(false);
    });

    test('[ENC06] RSA check interop NodeRSA <--> WebCryptoRSA', async () => {

        let rsa = new NodeRSA() as RSA;
        await rsa.generateKey(2048);
        let rsaPublic = new NodeRSA() as RSA;
        await rsaPublic.loadKeyPair(RSAImpl.PKCS8, rsa.getPublicKey());

        let rsa2 = new WebCryptoRSA() as RSA;
        await rsa2.loadKeyPair(RSAImpl.PKCS8, rsa.getPublicKey(), rsa.getPrivateKey());

        let rsaPublic2 = new WebCryptoRSA() as RSA;
        await rsaPublic2.loadKeyPair(RSAImpl.PKCS8, rsa2.getPublicKey());

        let message = '₿₿₿ this is a small text message 😱';

        let ciphertext = await rsaPublic.encrypt(message);
        expect(await rsa2.decrypt(ciphertext)).toEqual(message);

        let signature = await rsa2.sign(message);
        expect(await rsaPublic.verify(message, signature)).toEqual(true);

        let ciphertext2 = await rsaPublic2.encrypt(message);
        expect(await rsa.decrypt(ciphertext2)).toEqual(message);

        let signature2 = await rsa.sign(message);
        expect(await rsaPublic2.verify(message, signature2)).toEqual(true);

    });
});

