import { HashedObject } from "data/model/HashedObject";

abstract class Types {
    
    
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
            }
        }

        return valid;
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
            return (value instanceof HashedObject && value.getClassName() === typ);
        }
    }

}

export { Types };