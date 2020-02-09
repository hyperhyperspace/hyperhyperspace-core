interface SHA {

    sha1base64(text:string)   : string;
    sha256base64(text:string) : string;
    sha512base64(text:string) : string;

    sha1hex(text:string)   : string;
    sha256hex(text:string) : string;
    sha512hex(text:string) : string;

    sha1base64impl()   : (text:string) => string;
    sha256base64impl() : (text:string) => string;
    sha512base64impl() : (text:string) => string;

    sha1heximpl()   : (text:string) => string;
    sha256heximpl() : (text:string) => string;
    sha512heximpl() : (text:string) => string;

}

export { SHA };