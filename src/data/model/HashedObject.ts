import { Hashing, Hash } from './Hashing';
import { HashedSet } from './HashedSet';
import { Identity } from 'data/identity/Identity';
//import { __spreadArrays } from 'tslib';

type HashedObjectLiteral = { value: any, dependencies: Map<Hash, any> };


class HashedObject {

    static knownClasses = new Map<string, new () => HashedObject>();
    static registerClass(name: string, clazz: new () => HashedObject) {
        this.knownClasses.set(name, clazz);
    }

    private authors      : HashedSet<Identity>;   

    constructor() {
        this.authors    = new HashedSet<Identity>();
    } 

    init() {
        
    }

    addAuthor(author: Identity) {
        this.authors.add(author);
    }

    hash() {
        return this.toHashedLiterals()['hash'];
    }

    getClass() {
        return 'HashedObject';
    }

    toHashedLiterals() : { hash: Hash, literals: Map<Hash, any> } {
        
        let result = HashedObject.toLiteral(this);

        let hash  = result['value']['_content'];

        return { hash: hash, literals: result['dependencies']};
    }

    equals(another: HashedObject) {
        return this.hash() === another.hash();
    }

    static fromHashedLiterals(hashedLiterals :  { hash: Hash, literals: Map<Hash, any> }) : HashedObject {
        let hashReference = {'_type' : 'hash', '_content' : hashedLiterals['hash']};

        return HashedObject.fromLiteral({value : hashReference, dependencies : hashedLiterals['literals']});
    }

    static shouldLiteralize(something: any) {
        if (something === undefined || something === null) {
            return false;
        } else {
            let typ = typeof(something);

            if (typ === 'function' || typ === 'symbol') {
                return false;
            } else {
                return true;
            }
        }
    }

    static toLiteral(something: any) : { value: any, dependencies: Map<Hash, any> }  {

        let typ = typeof(something);

        let value;
        let dependencies = new Map<Hash, any>();

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            value = something;
        } else if (typ === 'object') {
            if (Array.isArray(something)) {
                value = [];
                for (const elmt of something) {
                    if (HashedObject.shouldLiteralize(elmt)) {
                        let child = HashedObject.toLiteral(elmt);
                        value.push(child['value']);
                        HashedObject.collectDeps(dependencies, child['dependencies']);
                    }
                }
            } else if (something instanceof HashedSet) {
                let hset = something as HashedSet<any>;
                let arrays = hset.toArrays();
                let hashes = arrays['hashes'];
                let children = HashedObject.toLiteral(arrays['elements']);
                let elements = children['value'];
                HashedObject.collectDeps(dependencies, children['dependencies']);

                value = {_type: 'hashed_set', _hashes: hashes, _elements: elements};

            } else { // not a set nor an array


                let contents = {} as any;

                for (const k of Object.keys(something)) {
                    if (k.length>0 && k[0] !== '_') {
                        let value = (something as any)[k];
                        if (HashedObject.shouldLiteralize(value)) {
                            let child = HashedObject.toLiteral(value);
                            contents[k] = child['value'];
                            HashedObject.collectDeps(dependencies, child['dependencies']);
                        }
                    }
                }

                if (something instanceof HashedObject) {
                    let hashedObject = something as HashedObject;
                    let depValue = {    _type: 'hashed_object', 
                                        _class: hashedObject.getClass(),
                                        _contents : contents    };
                    let depHash = Hashing.forValue(depValue);
                    value = {_type: 'hash', _content: depHash};
                    dependencies.set(depHash, depValue);
                } else {
                    value = contents;
                }
            }
        } else {
            throw Error("Unexpected type encountered while attempting to literalize: " + typ);
        }

        return { value: value, dependencies: dependencies};
    }

    static fromLiteral(literal: {value: any, dependencies: Map<Hash, any>}) : any  {

        const value = literal['value'];
        const dependencies = literal['dependencies'];

        let something: any;

        let typ = typeof(value);

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            something = value;
        } else if (typ === 'object') {
            if (Array.isArray(value)) {
                something = [];
               for (const elmt of value) {
                   something.push(HashedObject.fromLiteral({value: elmt, dependencies: dependencies}));
               }
            } else if (value['_type'] === 'hashed_set') {
                something = new HashedSet();
                
                let hashes = value['_hashes'];
                let elements = HashedObject.fromLiteral({value: value['_elements'], dependencies: dependencies});

                something.fromArrays(hashes, elements);
            } else {
                if (value['_type'] === 'hash') {
                    let hash = value['_content'];
                    something = HashedObject.fromLiteral({value: dependencies.get(hash), dependencies: dependencies});
                } else {
                    let contents;
                    if (value['_type'] === 'hashed_object') {
                        let constr = HashedObject.knownClasses.get(value['_class']);
                        if (constr === undefined) {
                            something = new HashedObject();
                        } else {
                            something = new constr();
                        }

                        contents = value['_contents'];
                    } else {
                        something = {} as any;
                        contents = value;
                    }
                    
                    for (const [key, propValue] of Object.entries(contents)) {
                        something[key] = HashedObject.fromLiteral({value: propValue, dependencies: dependencies});
                    }

                    if (value['_type'] === 'hashed_object') {
                        something.init();
                    }
                }
            }
        } else {
            throw Error("Unexpected type encountered while attempting to deliteralize: " + typ);
        }

        return something;
    }

    static stringifyLiteral(literal: {value: any, dependencies : Map<Hash, any>}) : string {
        return HashedObject.stringifyLiteralWithIndent(literal, 0);
    }

    private static stringifyLiteralWithIndent(literal: {value: any, dependencies : Map<Hash, any>}, indent: number) : string{
       
        console.log(literal);
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
                        something = something + HashedObject.stringifyLiteralWithIndent({value: elmt, dependencies: dependencies}, indent + 1);
                    }
                } else {
                    return '[]';
                }
                
               something = something + tab + ']';
            } else if (value['_type'] === 'hashed_set') {
                something = tab + 'HashedSet =>';
                something = something + HashedObject.stringifyLiteralWithIndent({value: value['_elements'], dependencies: dependencies}, indent + 1);

            } else {
                if (value['_type'] === 'hash') {
                    let hash = value['_content'];
                    something = HashedObject.stringifyLiteralWithIndent({value: dependencies.get(hash), dependencies: dependencies}, indent);
                } else {
                    something = tab;
                    let contents;
                    if (value['_type'] === 'hashed_object') {
                        let constr = HashedObject.knownClasses.get(value['_class']);
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
                        something = something + tab + '  ' + key + ':' + HashedObject.stringifyLiteralWithIndent({value: propValue, dependencies: dependencies}, indent + 1);
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

        console.log(hashedLiterals['literals']);

        for (let hash of hashedLiterals['literals'].keys()) {
            console.log(hash);
            s = s + hash + ' =>';
            s = s + HashedObject.stringifyLiteralWithIndent({'value': hashedLiterals['literals'].get(hash), dependencies: hashedLiterals['literals']}, 1);
        }

        return s;
    }

    static collectDeps(parent : Map<Hash, any>, child : Map<Hash, any>) : void {
        for (const [key, value] of child) {
            parent.set(key, value);
        }
    }

}

export { HashedObject, HashedObjectLiteral };