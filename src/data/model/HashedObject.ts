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
        
        let result = HashedObject.literalize(this);

        let hash  = result['value']['hash'];

        return { hash: hash, literals: result['dependencies']};
    }

    init() {
        
    }

    equals(another: HashedObject) {
        return this.hash() === another.hash();
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

    static literalize(something: any) : { value: any, dependencies: Map<Hash, any> }  {

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
                        let child = HashedObject.literalize(elmt);
                        value.push(child['value']);
                        HashedObject.collectDeps(dependencies, child['dependencies']);
                    }
                }
            } else if (something instanceof HashedSet) {
                let hset = something as HashedSet<any>;
                let arrays = hset.toArrays();
                let hashes = arrays['hashes'];
                let children = HashedObject.literalize(arrays['elements']);
                let elements = children['value'];
                HashedObject.collectDeps(dependencies, children['dependencies']);

                value = {_type: 'hashed_set', _hashes: hashes, _elements: elements};

            } else { // not a set nor an array


                let contents = {} as any;

                for (const k of Object.keys(something)) {
                    if (k.length>0 && k[0] !== '_') {
                        let value = (something as any)[k];
                        if (HashedObject.shouldLiteralize(value)) {
                            let child = HashedObject.literalize(value);
                            contents[k] = child['value'];
                            HashedObject.collectDeps(dependencies, child['dependencies']);
                        }
                    }
                }

                if (something instanceof HashedObject) {
                    let hashedObject = something as HashedObject;
                    let depValue = {_type: 'hashed_object', 
                                      _class: hashedObject.getClass(),
                                      _contents : contents};
                    let depHash = Hashing.forValue(depValue);
                    value = {_type: 'hash', _value: depHash};
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

    static deliteralize(literal: {value: any, dependencies: Map<Hash, any>}) : any  {

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
                   something.push(HashedObject.deliteralize({value: elmt, dependencies: dependencies}));
               }
            } else if (value['_type'] === 'hashed_set') {
                something = new HashedSet();

                let hashes = value['_hashes'];
                let elements = HashedObject.deliteralize({value: value['_elements'], dependencies: dependencies});

                something.fromArrays(hashes, elements);
            } else {
                if (value['_type'] === 'hash') {
                    let hash = value['_value'];
                    something = HashedObject.deliteralize({value: dependencies.get(hash), dependencies: dependencies});
                } else {
                    if (value['_type'] === 'hashed_object') {
                        let constr = HashedObject.knownClasses.get(value['_class']);
                        if (constr === undefined) {
                            something = new HashedObject();
                        } else {
                            something = new constr();
                        }

                        something.init();
                    } else {
                        something = {} as any;
                    }
                    
                    for (const [key, propValue] of Object.entries(value['_contents'])) {
                        something[key] = HashedObject.deliteralize({value: propValue, dependencies: dependencies});
                    }
                }
            }
        } else {
            throw Error("Unexpected type encountered while attempting to deliteralize: " + typ);
        }

        return something;
    }

    static collectDeps(parent : Map<Hash, any>, child : Map<Hash, any>) : void {
        for (const [key, value] of child) {
            parent.set(key, value);
        }
    }

}

export { HashedObject, HashedObjectLiteral };