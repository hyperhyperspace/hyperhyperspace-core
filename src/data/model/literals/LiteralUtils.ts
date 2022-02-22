import { HashedObject } from 'data/model';
import { Hash, Hashing } from '../hashing/Hashing';

type Literal           = { hash: Hash, value: any, author?: Hash, signature?: string, dependencies: Array<Dependency> }
type Dependency        = { path: string, hash: Hash, className: string, type: ('literal'|'reference') };

class LiteralUtils {

    static getType(literal: Literal): string {
        return literal.value['_type'];
    }

    static getClassName(literal: Literal): string {
        return literal.value['_class'];
    }

    static getFields(literal: Literal): any {
        return literal.value['_fields'];
    }

    static getFlags(literal: Literal): string[] {
        return literal.value['_flags'];
    }

    // FIXME: I think this break custom hashes!!!!
    // I think you cannot check the hash without deliteralizing the object.
    static validateHash(literal: Literal): boolean {
        return literal.hash === Hashing.forValue(literal.value);
    }

    static isLiteral(value: any, seen=new Set()): boolean {

        let typ = typeof(value);

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            return true;
        } else if (typ === 'object') {

            if (seen.has(value)) {
                return false;
            }

            seen.add(value);

            if (Array.isArray(value)) {

                for (const member of value) {
                    if (!LiteralUtils.isLiteral(member, seen)) {
                        return false;
                    }
                }

                return true;

            } else  {
                if (value instanceof HashedObject) {
                    return false;
                }

                let s = Object.prototype.toString.call(value);
                
                if (s !== '[object Object]') {
                    return false;
                }

                for (const fieldName of Object.keys(value)) {

                    if (!(typeof(fieldName) === 'string')) {
                        return false;
                    }

                    if (!LiteralUtils.isLiteral(value[fieldName], seen)) {
                        return false;
                    }
                }

                return true;
            }
        } else {
            return false;
        }

    }

}

export { Literal, Dependency, LiteralUtils }