
class Strings {

    static stingToArrayBuffer(str: string): ArrayBuffer {
        const buf = new ArrayBuffer(str.length);
        const bufView = new Uint8Array(buf);
        for (let i = 0, strLen = str.length; i < strLen; i++) {
          bufView[i] = str.charCodeAt(i);
        }
        return buf;
    }
    
    static Uint8arrayToBase64(u8: Uint8Array) {
        return btoa(String.fromCharCode.apply(null, Array.from(u8)));
    }

    static base64ToUint8array(base64: string): Uint8Array {
        const raw = atob(base64);

        const array = new Uint8Array(raw.length);

        for (let i=0; i<raw.length; i++) {
            array[i] = raw.charCodeAt(i);
        }

        return array;
    }

    static base64toHex(base64: string): string {

        var raw = atob(base64);

        var hex = '';

        for (let i = 0; i < raw.length; i++ ) {

            var _hex = raw.charCodeAt(i).toString(16)

            hex += (_hex.length==2?_hex:'0'+_hex);

        }

        return hex.toUpperCase();
      
    }



    static hexToBase64(hex: string) {
        return btoa((hex.match(/\w{2}/g) as string[]).map(function(a) {
            return String.fromCharCode(parseInt(a, 16));
        }).join(""));
    }

    // Slow but simple chunker to use on small strings:
    // RSA-encoded symmetric keys, etc.

    static chunk(text: string, length: number) : Array<string> {

        let chunks = new Array<string>();

        while (text.length > length) {
            let chunk = text.slice(0, length);
            chunks.push(chunk);
            text = text.slice(length, text.length);
        }

        chunks.push(text);

        return chunks;
    }

    static unchunk(chunks: Array<string>) : string {
        let text = '';

        for (let chunk of chunks) {
            text = text + chunk;
        }

        return text;
    }
}

export { Strings };