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

        //Error.stackTraceLimit=300;
        //console.log('hashing from:', new Error().stack);

        //const t = performance.now();

        const firstPass  = Hashing.sha.sha256base64('0a' + text + seed);

        //const ty = performance.now();

        const secondPass = Hashing.rmd.rmd160base64(text + firstPass); 

        //const tz= performance.now();

        //console.trace();
        //console.log(' *** hashing took ', tz - t, ' for result ', secondPass);
        //console.log(' *** SHA: ', (ty-t), ' RMD: ', (tz-ty));

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