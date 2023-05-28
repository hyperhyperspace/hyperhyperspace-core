
type BigIntLiteral = { '_type': 'bigint_literal', '_value': BigIntAsHexString }
type BigIntAsHexString = string;

class BigIntParser {

    static literalize(n: bigint): BigIntLiteral {
        return { '_type': 'bigint_literal', '_value': BigIntParser.encode(n) };
    }

    static deliteralize(lit: BigIntLiteral, validate=false): bigint {
        if (lit['_type'] !== 'bigint_literal') {
            throw new Error("Trying to deliteralize bigint, but _type is '" + lit['_type'] + "' (shoud be 'bigint_literal').");
        }

        if (validate && !BigIntParser.checkEncoding(lit['_value'])) {
            throw new Error("Received bigint literal is not properly encoded.");
        }

        return BigIntParser.decode(lit._value);
    }

    static encode(n: bigint): BigIntAsHexString {
        const sign = (n < BigInt(0)) ? '-' : '+'; 

        return sign + (n < BigInt(0)? -n : n).toString(16);
    }

    static decode(h: BigIntAsHexString): bigint {
        const p = BigIntParser.parse(h);

        const val = BigInt('0x' + p.hex);

        if (p.sign === '-') {
            return -val;
        } else {
            return val;
        }
    }

    static checkEncoding(h: BigIntAsHexString|undefined): boolean {
        try {

            if (h === undefined) {
                return false;
            }

            if (typeof(h) !== 'string') {
                return false;
            }

            const p = BigIntParser.parse(h);

            if (['+', '-'].indexOf(p.sign) < 0) {
                return false;
            }

            if (!/^[0-9a-f]+$/.test(p.hex) || /^0[0-9a-f]+$/.test(p.hex)) {
                return false;
            }
            
            return true;
        } catch (e) {
            return false;
        }
    }

    private static parse(h: BigIntAsHexString) : { sign:string, hex: string } {
        return { sign: h[0], hex: h.slice(1) }
    }
}

export { BigIntParser, BigIntLiteral }