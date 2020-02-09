interface RMD {

    rmd160base64(text: string) : string;
    rmd160hex(text: string) : string;

    rmd160base64impl() : (text: string) => string;
    rmd160heximpl() : (text: string) => string;

}

export { RMD };