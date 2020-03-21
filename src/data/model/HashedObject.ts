import { Hashing, Hash } from './Hashing';
import { HashedSet } from './HashedSet';
import { Identity } from 'data/identity/Identity';
import { HashReference } from './HashReference';

type Literal           = { hash: Hash, value: any, authors: Set<Identity>, dependencies: Set<Dependency> }
type Reference         = { hash: Hash, className: string };
type LiteralizedObject = { literal: Literal, object: Object };
type Dependency        = { path: string, target: (LiteralizedObject | Reference) };

class HashedObject {

    static knownClasses = new Map<string, new () => HashedObject>();
    static registerClass(name: string, clazz: new () => HashedObject) {
        this.knownClasses.set(name, clazz);
    }

    private authors : HashedSet<Identity>;

    constructor() {
        this.authors = new HashedSet<Identity>();
    } 

    init() {
        
    }

    addAuthor(author: Identity) {
        this.authors.add(author);
    }

    getAuthors() {
        return this.authors.elements();
    }

    hash() {
        return this.toLiteral().hash;
    }

    createReference() : HashReference {
        return new HashReference(this.hash(), this.getClass());
    }

    getClass() {
        return 'HashedObject';
    }

    toLiteral() : Literal {
        
        let fields = {} as any;
        let dependencies = new Set<Dependency>();

        for (const fieldName of Object.keys(this)) {
            if (fieldName.length > 0 && fieldName[0] !== '_') {
                let value = (this as any)[fieldName];

                if (HashedObject.shouldLiteralizeField(value)) {
                    let fieldLiteral = HashedObject.literalizeField(fieldName, value);
                    fields[fieldName] = fieldLiteral.value;
                    HashedObject.collectChildDeps(dependencies, fieldLiteral.dependencies);
                }
            }
        }
        
        let value = {
            _type: 'hashed_object', 
            _class: this.getClass(),
            _fields : fields
        };

        let hash = Hashing.forValue(value);

        return { hash: hash, value: value, authors: new Set(this.getAuthors()) , dependencies: dependencies };
    }

    equals(another: HashedObject) {
        return this.hash() === another.hash();
    }

    static shouldLiteralizeField(something: any) {

        if (something === null) {
            throw new Error('HashedObject and its derivatives do not support null-valued fields.');
        }

        if (something === undefined) {
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

    static literalizeField(fieldPath: string, something: any) : { value: any, dependencies : Set<Dependency> }  {

        let typ = typeof(something);

        let value;
        let dependencies = new Set<Dependency>();

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            value = something;
        } else if (typ === 'object') {
            if (Array.isArray(something)) {
                value = [];
                let index = 0;
                for (const elmt of something) {
                    if (HashedObject.shouldLiteralizeField(elmt)) {
                        let child = HashedObject.literalizeField(fieldPath, elmt); // should we put the index into the path? but then we can't reuse this code for sets...
                        value.push(child.value);
                        HashedObject.collectChildDeps(dependencies, child.dependencies);
                        index = index + 1;
                    }
                }
            } else if (something instanceof HashedSet) {
                let hset = something as HashedSet<any>;
                let arrays = hset.toArrays();
                let hashes = arrays.hashes;
                let child = HashedObject.literalizeField(fieldPath, arrays.elements);
                let elements = child.value;
                HashedObject.collectChildDeps(dependencies, child.dependencies);

                value = {_type: 'hashed_set', _hashes: hashes, _elements: elements};

            } else { // not a set nor an array

                if (something instanceof HashReference) {
                    let reference = something as HashReference;

                    value = { _type: 'hashed_object_reference', _hash: reference.hash, _class: reference.className};
                } else if (something instanceof HashedObject) {
                    let hashedObject = something as HashedObject;
                    let literalized = { object: hashedObject, literal: hashedObject.toLiteral() } as LiteralizedObject;

                    let dependency = { path: fieldPath, target: literalized};
                    dependencies.add(dependency);

                    value = { _type: 'hashed_object_dependency', _hash: literalized.literal.hash };
                } else {
                    value = {} as any;

                    for (const fieldName of Object.keys(something)) {
                        if (fieldName.length>0 && fieldName[0] !== '_') {
                            let fieldValue = (something as any)[fieldName];
                            if (HashedObject.shouldLiteralizeField(fieldValue)) {
                                let field = HashedObject.literalizeField(fieldPath + '.' + fieldName, fieldValue);
                                value[fieldName] = field.value;
                                HashedObject.collectChildDeps(dependencies, field.dependencies);
                            }
                        }
                    }
                }
            }
        } else {
            throw Error("Unexpected type encountered while attempting to literalize: " + typ);
        }

        return { value: value, dependencies: dependencies };
    }

    static fromLiteral(literal: Literal) : HashedObject {
        const value = literal.value;
        const dependencies = new Map<Hash, LiteralizedObject>();

        for (const dep of literal.dependencies) {
            if ((dep.target as LiteralizedObject).literal) {
                let literalized = (dep.target as LiteralizedObject) as LiteralizedObject;
                dependencies.set(literalized.literal.hash, literalized);
            }   
        }

        if (value['_type'] !== 'hashed_object') {
            throw new Error("Missing 'hashed_object' type signature while attempting to deliteralize " + literal.hash);
        }
        
        let constr = HashedObject.knownClasses.get(value['_class']);

        let hashedObject;

        if (constr === undefined) {
            hashedObject = new HashedObject();
        } else {
            hashedObject = new constr();
        }

        for (const [fieldName, fieldValue] of Object.entries(value['_fields'])) {
            if (fieldName.length>0 && fieldName[0] !== '_') {
                (hashedObject as any)[fieldName] = HashedObject.deliteralizeField(fieldValue, dependencies);
            }
        }

        hashedObject.init();

        return hashedObject;
    }

    static deliteralizeField(value: any, dependencies: Map<Hash, LiteralizedObject>) : any  {

        let something: any;

        let typ = typeof(value);

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            something = value;
        } else if (typ === 'object') {
            if (Array.isArray(value)) {
                something = [];
               for (const elmt of value) {
                   something.push(HashedObject.deliteralizeField(elmt, dependencies));
               }
            } else if (value['_type'] === undefined) {
                something = {} as any;

                for (const [fieldName, fieldValue] of Object.entries(value)) {
                    something[fieldName] = HashedObject.deliteralizeField(fieldValue, dependencies);
                }
            } else {
                if (value['_type'] === 'hashed_set') {
                    let hashes = value['_hashes'];
                    let elements = HashedObject.deliteralizeField(value['_elements'], dependencies);
                    
                    something = new HashedSet();
                    something.fromArrays(hashes, elements);
                } else if (value['_type'] === 'hashed_object_reference') {
                    something = new HashReference(value['_hash'], value['_class']);
                } else if (value['_type'] === 'hashed_object_dependency') {
                    let hash = value['_hash'];
                    something = (dependencies.get(hash) as LiteralizedObject).object;
                } else if (value['_type'] === 'hashed_object') {
                    throw new Error("Attempted to deliteralize embedded hashed object in literal (a hash reference should be used instead)");
                } else {
                    throw new Error("Unknown _type value found while attempting to deliteralize: " + value['_type']);
                }
            }
        } else {
            throw Error("Unexpected type encountered while attempting to deliteralize: " + typ);
        }

        return something;
    }

    static collectChildDeps<T extends (Dependency | Reference)> (parentDeps : Set<T>, childDeps : Set<T>) {
        for (const childDep of childDeps) {
            parentDeps.add(childDep);
        }
    }

    // the following only for pretty printing.

    static stringifyLiteral(literal: {value: any, dependencies : Map<Hash, any>}) : string {
        return HashedObject.stringifyLiteralWithIndent(literal, 0);
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

        for (let hash of hashedLiterals['literals'].keys()) {
            s = s + hash + ' =>';
            s = s + HashedObject.stringifyLiteralWithIndent({'value': hashedLiterals['literals'].get(hash), dependencies: hashedLiterals['literals']}, 1);
        }

        return s;
    }

}

HashedObject.registerClass('HashedObject', HashedObject);

export { HashedObject, Literal, LiteralizedObject, Reference, Dependency };