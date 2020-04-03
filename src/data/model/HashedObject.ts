import { Hashing, Hash } from './Hashing';
import { HashedSet } from './HashedSet';
import { Identity } from 'data/identity/Identity';
import { HashReference } from './HashReference';
import { __spreadArrays } from 'tslib';
import { RNGImpl } from 'crypto/random';
import { HashNamespace } from './HashNamespace';
import { Store } from 'data/storage/Store';
import { CurrentState } from './state/CurrentState';

type Literal           = { hash: Hash, value: any, authors: Array<Hash>, dependencies: Set<Dependency> }
type Dependency        = { path: string, hash: Hash, className: string, type: ('literal'|'reference') };

type ObjectContext  = { rootHash?: Hash, objects: Map<Hash, HashedObject> };
type LiteralContext = { rootHash?: Hash, literals: Map<Hash, Literal> };
type Context = ObjectContext & LiteralContext;

const BITS_FOR_ID = 128;


/* HashedObject: Base class for objects than need to be storable in the
                 Hyper Hyper Space global content-addressed database.

 Defines how an object will be serialized, hashed, who it was authored by,
 whether it needs an id (randomized or derived from a parent object's id)
 and how it should be attached to a given store & context. */

class HashedObject {

    static knownClasses = new Map<string, new () => HashedObject>();
    static registerClass(name: string, clazz: new () => HashedObject) {
        this.knownClasses.set(name, clazz);
    }

    private id?     : string;
    private authors : HashedSet<Identity>;

    private   _store?        : Store;
    private   _storedHash?   : Hash;
    protected _currentState? : CurrentState;


    constructor() {
        this.authors = new HashedSet<Identity>();
    } 

    init() {
        
    }

    getId() : (string | undefined) {
        return this.id;
    }

    setId(id: string) {
        this.id = id;
    }

    setRandomId() {
        //TODO: use b64 here
        this.id = new RNGImpl().randomHexString(BITS_FOR_ID);
    }

    addAuthor(author: Identity) {
        this.authors.add(author);
    }

    getAuthors() {
        return this.authors;
    }

    overrideChildrenId() : void {
        for (const fieldName of Object.keys(this)) {
            if (fieldName.length > 0 && fieldName[0] !== '_') {
                let value = (this as any)[fieldName];
                if (value instanceof HashedObject) {
                    this.overrideIdForPath(fieldName, value);
                }
            }
        }
    }

    overrideIdForPath(path: string, target: HashedObject) : void {
        let parentId = this.getId();

        if (parentId === undefined) {
            throw new Error("Can't override a child's Id because parent's Id is unset");
        }

        target.setId(HashNamespace.generateIdForPath(parentId, path));
    }

    setStore(store: Store) : void {
        this._store = store;
    }

    getStore() : Store {

        if (this._store === undefined) {
            throw new Error('Attempted to get store within an unstored object.')
        }

        return this._store as Store;
    }

    setStoredHash(hash: Hash) {
        this._storedHash = hash;
    }

    getStoredHash() {
        
        if (this._storedHash === undefined) {
            throw new Error('Attempted to get stored hash within an unstored object.');
        }

        return this._storedHash as Hash;
    }

    hash() {
        return this.toLiteralContext().rootHash as Hash;
    }

    createReference() : HashReference {
        return new HashReference(this.hash(), this.getClassName());
    }

    getClassName() {
        return 'HashedObject';
    }

    toLiteralContext() : LiteralContext /*DeliteralizationContext*/ {

        let literalContext: LiteralContext = { literals: new Map() };
        //let context = { objects: new Map(), literals: new Map() } as Context

        literalContext.rootHash = this.literalizeInContext(literalContext, '');

        return literalContext;
    }

    literalizeInContext(context: LiteralContext, path: string, flags?: Array<string>) : Hash {
        
        let fields = {} as any;
        let dependencies = new Set<Dependency>();

        for (const fieldName of Object.keys(this)) {
            if (fieldName.length > 0 && fieldName[0] !== '_') {
                let value = (this as any)[fieldName];

                if (HashedObject.shouldLiteralizeField(value)) {
                    let fieldPath = fieldName;
                    if (path !== '') {
                        fieldPath = path + '.' + fieldName;
                    }
                    let fieldLiteral = HashedObject.literalizeField(fieldPath, value, context);
                    fields[fieldName] = fieldLiteral.value;
                    HashedObject.collectChildDeps(dependencies, fieldLiteral.dependencies);
                }
            }
        }
        
        if (flags === undefined) { flags = []; }

        let value = {
            _type   : 'hashed_object', 
            _class  : this.getClassName(),
            _fields : fields,
            _flags  : flags
        };

        let hash = Hashing.forValue(value);
        
        let authors = value['_fields']['authors']['_hashes'] as Array<Hash>;

        let literal: Literal = { hash: hash, value: value, authors: authors , dependencies: dependencies };

        //context.objects.set(hash, this);
        context.literals.set(hash, literal);

        return hash;
    }

    equals(another: HashedObject) {
        return this.hash() === another.hash();
    }

    clone() : this {
        let lc = this.toLiteralContext();
        //lc.context.objects = new Map<Hash, HashedObject>();

        let clone = HashedObject.fromLiteralContext(lc) as this;

        return clone;
    }

    initSharedState() {
        this._currentState = new CurrentState();
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

    static literalizeField(fieldPath: string, something: any, context?: LiteralContext) : { value: any, dependencies : Set<Dependency> }  {

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
                        let child = HashedObject.literalizeField(fieldPath, elmt, context); // should we put the index into the path? but then we can't reuse this code for sets...
                        value.push(child.value);
                        HashedObject.collectChildDeps(dependencies, child.dependencies);
                        index = index + 1;
                    }
                }
            } else if (something instanceof HashedSet) {
                let hset = something as HashedSet<any>;
                let arrays = hset.toArrays();
                let hashes = arrays.hashes;
                let child = HashedObject.literalizeField(fieldPath, arrays.elements, context);
                let elements = child.value;
                HashedObject.collectChildDeps(dependencies, child.dependencies);

                value = {_type: 'hashed_set', _hashes: hashes, _elements: elements};

            } else { // not a set nor an array

                if (something instanceof HashReference) {
                    let reference = something as HashReference;

                    let dependency : Dependency = { path: fieldPath, hash: reference.hash, className: reference.className, type: 'reference'};
                    dependencies.add(dependency);

                    value = { _type: 'hashed_object_reference', _hash: reference.hash, _class: reference.className};
                } else if (something instanceof HashedObject) {
                    let hashedObject = something as HashedObject;

                    if (context === undefined) {
                        throw new Error('Context needed to deliteralize HashedObject');
                    }

                    let hash = hashedObject.literalizeInContext(context, fieldPath);

                    let dependency : Dependency = { path: fieldPath, hash: hash, className: hashedObject.getClassName(), type: 'literal'};
                    dependencies.add(dependency);

                    value = { _type: 'hashed_object_dependency', _hash: hash };
                } else {
                    value = {} as any;

                    for (const fieldName of Object.keys(something)) {
                        if (fieldName.length>0 && fieldName[0] !== '_') {
                            let fieldValue = (something as any)[fieldName];
                            if (HashedObject.shouldLiteralizeField(fieldValue)) {
                                let field = HashedObject.literalizeField(fieldPath + '.' + fieldName, fieldValue, context);
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


    static fromLiteralContext(literalContext: LiteralContext /*DeliteralizationContext*/ ) : HashedObject {
        let context = { rootHash: literalContext.rootHash, 
                        literals: literalContext.literals, 
                        objects:  new Map()};

        return HashedObject.fromContext(context);
    }

    static fromContext(context: Context) : HashedObject {

        if (context.rootHash === undefined) {
            throw new Error("Can't recreate object from context because its rootHash is missing");
        }

        HashedObject.deliteralizeInContext(context.rootHash, context);

        return context.objects.get(context.rootHash) as HashedObject;
    }

    // deliteralizeInContext: take the literal with the given hash from the context,
    //                        recreate the object and insert it into the context
    //                        (be smart and only do it if it hasn't been done already)

    static deliteralizeInContext(hash: Hash, context: Context) : void {

        let hashedObject = context.objects.get(hash);

        if (hashedObject !== undefined) {
            return;
        }

        let literal = context.literals.get(hash);

        if (literal === undefined) {
            throw new Error("Can't deliteralize object with hash " + hash + " because its literal is missing from the received context");
        }

        const value = literal.value;

        // all the dependencies have been delieralized in the context

        if (value['_type'] !== 'hashed_object') {
            throw new Error("Missing 'hashed_object' type signature while attempting to deliteralize " + literal.hash);
        }
        
        let constr = HashedObject.knownClasses.get(value['_class']);

        if (constr === undefined) {
            hashedObject = new HashedObject();
        } else {
            hashedObject = new constr();
        }

        for (const [fieldName, fieldValue] of Object.entries(value['_fields'])) {
            if (fieldName.length>0 && fieldName[0] !== '_') {
                (hashedObject as any)[fieldName] = HashedObject.deliteralizeField(fieldValue, context);
            }
        }

        hashedObject.init();

        context.objects.set(literal.hash, hashedObject);
    }

    static deliteralizeField(value: any, context: Context) : any  {

        let something: any;

        let typ = typeof(value);

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            something = value;
        } else if (typ === 'object') {
            if (Array.isArray(value)) {
                something = [];
               for (const elmt of value) {
                   something.push(HashedObject.deliteralizeField(elmt, context));
               }
            } else if (value['_type'] === undefined) {
                something = {} as any;

                for (const [fieldName, fieldValue] of Object.entries(value)) {
                    something[fieldName] = HashedObject.deliteralizeField(fieldValue, context);
                }
            } else {
                if (value['_type'] === 'hashed_set') {
                    let hashes = value['_hashes'];
                    let elements = HashedObject.deliteralizeField(value['_elements'], context);
                    
                    something = new HashedSet();
                    something.fromArrays(hashes, elements);
                } else if (value['_type'] === 'hashed_object_reference') {
                    something = new HashReference(value['_hash'], value['_class']);
                } else if (value['_type'] === 'hashed_object_dependency') {
                    let hash = value['_hash'];

                    HashedObject.deliteralizeInContext(hash, context);
                    something = context.objects.get(hash) as HashedObject;

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

    static collectChildDeps(parentDeps : Set<Dependency>, childDeps : Set<Dependency>) {
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

export { HashedObject, Literal, Dependency, Context, LiteralContext, ObjectContext };