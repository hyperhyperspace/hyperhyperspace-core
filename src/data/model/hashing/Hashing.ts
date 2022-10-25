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

        //const t = Date.now();

        const firstPass  = Hashing.sha.sha256base64('0a' + text + seed);
        const secondPass = Hashing.rmd.rmd160base64(text + firstPass); 

        //console.trace();
        //console.log(' *** hashing took ', Date.now() - t, ' for result ', secondPass);

        return secondPass;
    }

    static forValue(value: any, seed?: string) : Hash{
        //const t = Date.now()
        const text = Serialization.default(value);
        //console.log(' *** serialization took ', Date.now() - t);
        
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