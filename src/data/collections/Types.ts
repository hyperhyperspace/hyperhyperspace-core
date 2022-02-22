import { HashedSet } from 'data/model';
import { HashedObject } from '../model/immutable/HashedObject';

abstract class Types {
    
    static HashedObject = 'HashedObject';
    
    static isTypeConstraint(types?: Array<string>) {

        let valid = true;

        if (types !== undefined) {

            if (!Array.isArray(types) ) {
                valid = false;
            } else {
                for (const typ of types) {
                    if ((typeof typ) !== 'string') {
                        valid = false;
                    }
                }

                if (new HashedSet(types.values()).size() !== types.length) {
                    return false;
                }
            }
        }

        return valid;
    }

    static checkTypeConstraint(received: Array<string>|undefined, expected: Array<string>): boolean {
        if (!Types.isTypeConstraint(received)) {
            return false;
        }

        const r = new HashedSet(received?.values());
        const e = new HashedSet(expected.values());

        if (r.hash() !== e.hash()) {
            return false;
        }

        return true;
    }

    static satisfies(value: any, types?: Array<string>) {

        let satisfies = true;

        if (types !== undefined) {
            for (const typ of types) {
                if (Types.hasType(value, typ)) {
                    satisfies = true;
                    break;
                }
            }
        }

        return satisfies;
    }
    
    static hasType(value: any, typ: string): boolean {
        if (typ === 'string') {
            return (typeof value) === 'string';
        } else if (typ === 'number') {
            return (typeof value) === 'number';
        } else {
            return (value instanceof HashedObject && (typ === Types.HashedObject || typ === value.getClassName()));
        }
    }

}

export { Types };