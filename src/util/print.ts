import { Hash } from "data/model";
import { ClassRegistry } from "data/model/literals/ClassRegistry";

class Print {
    // the following only for pretty printing.

    static stringifyLiteral(literal: {value: any, dependencies : Map<Hash, any>}) : string {
        return Print.stringifyLiteralWithIndent(literal, 0);
    }

    private static stringifyLiteralWithIndent(literal: {value: any, dependencies : Map<Hash, any>}, indent: number) : string{
       
        const value = literal['value'];
        const dependencies = literal['dependencies'];

        let something: string;

        let typ = typeof(value);

        let tab = '\n' + ' '.repeat(indent * 4);

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            something = value;
        } else if (typ === 'object') {
            if (Array.isArray(value)) {
                if (value.length > 0) {
                    something =  tab + '[';
                    let first = true;
                    for (const elmt of value) {
                        if (!first) {
                            something = something + tab + ',';
                        }
                        first = false;
                        something = something + Print.stringifyLiteralWithIndent({value: elmt, dependencies: dependencies}, indent + 1);
                    }
                } else {
                    return '[]';
                }
                
               something = something + tab + ']';
            } else if (value['_type'] === 'hashed_set') {
                something = tab + 'HashedSet =>';
                something = something + Print.stringifyLiteralWithIndent({value: value['_elements'], dependencies: dependencies}, indent + 1);

            } else {
                if (value['_type'] === 'hash') {
                    let hash = value['_content'];
                    something = Print.stringifyLiteralWithIndent({value: dependencies.get(hash), dependencies: dependencies}, indent);
                } else {
                    something = tab;
                    let contents;
                    if (value['_type'] === 'hashed_object') {
                        let constr = ClassRegistry.lookup(value['_class']);
                        if (constr === undefined) {
                            something = something + 'HashedObject: ';
                        } else {
                            something = something + value['_class'] + ' ';
                        }
                        contents = value['_contents'];
                    } else {
                        contents = value;
                    }

                    something = something + '{';
                    
                    for (const [key, propValue] of Object.entries(contents)) {
                        something = something + tab + '  ' + key + ':' + Print.stringifyLiteralWithIndent({value: propValue, dependencies: dependencies}, indent + 1);
                    }

                    something = something + tab + '}'
                }
            }
        } else {
            throw Error("Unexpected type encountered while attempting to deliteralize: " + typ);
        }

        return something;

    }

    static stringifyHashedLiterals(hashedLiterals: {hash: Hash, literals: Map<Hash, any>}) : string {
        let s = '';

        for (let hash of hashedLiterals['literals'].keys()) {
            s = s + hash + ' =>';
            s = s + Print.stringifyLiteralWithIndent({'value': hashedLiterals['literals'].get(hash), dependencies: hashedLiterals['literals']}, 1);
        }

        return s;
    }
}

export { Print }