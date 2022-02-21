import { SHA, RMD, SHAImpl, RMDImpl } from 'crypto/hashing';
import { Strings } from 'util/strings';
import { Serialization } from './Serialization';

type Hash = string;

class Hashing {

    static sha = new SHAImpl() as SHA;
    static rmd = new RMDImpl() as RMD;

    static forString(text: string, seed?: string) : Hash {

        if (seed === undefined) {
            seed = '';
        }

        let firstPass  = Hashing.sha.sha256base64('0a' + text + seed);
        let secondPass = Hashing.rmd.rmd160base64(text + firstPass); 

        return secondPass;
    }

    static forValue(value: any, seed?: string) : Hash{
        let text = Serialization.default(value);
        
        return Hashing.forString(text, seed);
    }

    static toHex(hash: Hash) {
        return Strings.base64toHex(hash);
    }

    static fromHex(hex: string) {
        return Strings.hexToBase64(hex);
    }

 }

export { Hashing, Hash };