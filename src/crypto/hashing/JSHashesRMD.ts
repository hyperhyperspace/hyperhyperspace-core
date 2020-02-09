import Hashes from 'jshashes';
import { RMD } from './RMD'; 

class JSHashesRMD implements RMD {
    rmd160base64func: (text: string) => string;
    rmd160hexfunc: (text:string) => string;

    constructor() {
        this.rmd160base64func = new Hashes.RMD160().b64;
        this.rmd160hexfunc    = new Hashes.RMD160().hex;
    }

    rmd160base64(text: string) {
        return this.rmd160base64func(text);
    }

    rmd160hex(text: string) {
        return this.rmd160hexfunc(text);
    }

    rmd160base64impl() {
        return this.rmd160base64func;
    }

    rmd160heximpl() {
        return this.rmd160hexfunc;
    }

}

export { JSHashesRMD };