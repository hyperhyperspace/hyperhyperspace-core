import Hashes from 'jshashes';
import { SHA } from './SHA';


class JSHashesSHA implements SHA {

    sha1base64func:   (text: string) => string;
    sha256base64func: (text: string) => string;
    sha512base64func: (text: string) => string;

    sha1hexfunc:   (text: string) => string;
    sha256hexfunc: (text: string) => string;
    sha512hexfunc: (text: string) => string;

    constructor() {
        this.sha1base64func   = new Hashes.SHA1().b64;
        this.sha256base64func = new Hashes.SHA256().b64;
        this.sha512base64func = new Hashes.SHA512().b64;

        this.sha1hexfunc   = new Hashes.SHA1().hex;
        this.sha256hexfunc = new Hashes.SHA256().hex;
        this.sha512hexfunc = new Hashes.SHA512().hex;
    }

    sha1base64(text: string) {
        return this.sha1base64func(text);
    }

    sha256base64(text: string) {
        return this.sha256base64func(text);
    }

    sha512base64(text: string) {
        return this.sha512base64func(text);
    }

    sha1hex(text: string) {
        return this.sha1hexfunc(text);
    }

    sha256hex(text: string) {
        return this.sha256hexfunc(text);
    }

    sha512hex(text: string) {
        return this.sha512hexfunc(text);
    }

    sha1base64impl() {
        return this.sha1base64func;
    }

    sha256base64impl() {
        return this.sha256base64func;
    }

    sha512base64impl() {
        return this.sha512base64func;
    }

    sha1heximpl() {
        return this.sha1hexfunc;
    }

    sha256heximpl() {
        return this.sha256hexfunc;
    }

    sha512heximpl() {
        return this.sha512hexfunc;
    }
}

export { JSHashesSHA };