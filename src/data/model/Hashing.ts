import { SHA, RMD, SHAImpl, RMDImpl } from 'crypto/hashing';
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
        let secondPass = Hashing.rmd.rmd160base64('0b' + text + firstPass); 

        return ('01' + secondPass);
    }

    static forValue(value: any, seed?: string) : Hash{
        let text = Serialization.default(value);
        
        return Hashing.forString(text, seed);
    }

    static forLiteral(literal: {value: any, dependencies: Map<Hash, any>}, seed?: string) : Hash {
        
        return Hashing.forValue(literal['value'], seed);

    }
 }

export { Hashing, Hash };