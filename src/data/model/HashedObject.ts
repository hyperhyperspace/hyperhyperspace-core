import { Store } from 'storage/store';

import { RNGImpl } from 'crypto/random';

import { Identity } from '../identity/Identity';

import { Hashing, Hash } from './Hashing';

import { HashedSet } from './HashedSet';
import { HashReference } from './HashReference';
import { HashedMap } from './HashedMap';

import { Context, LiteralContext } from './Context';

import { Mesh } from 'mesh/service';
import { Resources } from 'spaces/spaces';

import { __spreadArrays } from 'tslib';


type Literal           = { hash: Hash, value: any, author?: Hash, signature?: string, dependencies: Array<Dependency> }
type Dependency        = { path: string, hash: Hash, className: string, type: ('literal'|'reference') };

//type ObjectContext    = { rootHashes: Array<Hash>, objects: Map<Hash, HashedObject> };
//type LiteralContext   = { rootHashes: Array<Hash>, literals: Map<Hash, Literal> };
//type Context = { rootHashes: Array<Hash>, objects: Map<Hash, HashedObject>, literals: Map<Hash, Literal>, aliased?: Map<Hash, HashedObject> };  //ObjectContext & Partial<AliasingContext>;

const BITS_FOR_ID = 128;


/* HashedObject: Base class for objects than need to be storable in the
                 Hyper Hyper Space global content-addressed database.

 Defines how an object will be serialized, hashed, who it was authored by,
 whether it needs an id (randomized or derived from a parent object's id)
 and which objects should be preloaded when loading operations that mutate
 this object and its subobjects. */

abstract class HashedObject {

    static knownClasses = new Map<string, new () => HashedObject>();
    static registerClass(name: string, clazz: new () => HashedObject) {
        this.knownClasses.set(name, clazz);
    }

    private id?     : string;
    private author? : Identity;

    
    private _signOnLiteraliz  : boolean;
    //private _store?           : Store;
    private _lastHash?        : Hash;
    private _lastSignature?   : string;

    private _resources? : Resources;

    constructor() {
        this._signOnLiteraliz = false;
    } 

    abstract getClassName() : string;

    abstract init() : void;
    abstract validate(references: Map<Hash, HashedObject>) : boolean;

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

    setAuthor(author: Identity) {
        if (!author.hasKeyPair()) {
            throw new Error('Trying to set the author of an object, but the received identity does not have an attached key pair to sign it.');
        }

        if (!author.equals(this.author)) {
            this.author = author;
            this._signOnLiteraliz = true;
        }
        
    }

    getAuthor() {
        return this.author;
    }

    hasLastSignature() : boolean {
        return this._lastSignature !== undefined;
    }

    setLastSignature(signature: string) : void {
        this._lastSignature = signature;
    }

    getLastSignature() : string {
        if (this._lastSignature === undefined) {
            throw new Error('Attempted to retrieve last signature for unsigned object');
        }

        return this._lastSignature;
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

        target.setId(HashedObject.generateIdForPath(parentId, path));
    }

    hasStore() : boolean {
        return this._resources?.store !== undefined;
    }

    setStore(store: Store) : void {

        if (this._resources === undefined) {
            this._resources = { } as Resources;
        }

        this._resources.store = store;
    }

    getStore() : Store {

        if (!this.hasStore()) {
            throw new Error('Attempted to get store from object resources, but one is not present.');
        }

        return this._resources?.store as Store;
    }

    getMesh() : Mesh {
        if (this._resources?.mesh === undefined) {
            throw new Error('Attempted to get mesh from object resources, but one is not present.');
        } else {
            return this._resources?.mesh;
        }
    }

    hasLastHash() {
        return this._lastHash !== undefined;
    }

    setLastHash(hash: Hash) {
        this._lastHash = hash;
    }

    getLastHash() {
        
        if (this._lastHash === undefined) {
            throw new Error('Attempted to get stored hash within an unstored object.');
        }

        return this._lastHash as Hash;
    }

    hash(seed?: string): Hash {

        let hash = this.customHash(seed);

        if (hash === undefined) {
            let context = this.toContext();
            if (seed === undefined) {
                hash = context.rootHashes[0] as Hash;
            } else {
                let literal = context.literals.get(context.rootHashes[0]) as Literal;
                hash = Hashing.forValue(literal.value, seed);
            }
            
        }

        if (seed === undefined) { 
            this._lastHash = hash;
        }

        return hash;
    }

    customHash(seed?: string) : Hash | undefined {
        seed;
        return undefined;
    }

    createReference() : HashReference<this> {
        return new HashReference(this.hash(), this.getClassName());
    }

    equals(another: HashedObject | undefined) {

        return another !== undefined && this.hash() === another.hash();
    }

    clone() : this {
        let c = this.toContext();
        
        c.objects = new Map<Hash, HashedObject>();

        let clone = HashedObject.fromContext(c) as this;

        return clone;
    }

    addDerivedField(fieldName: string, object: HashedObject) {
        object.setId(this.getDerivedFieldId(fieldName));
        (this as any)[fieldName] = object;
    }

    checkDerivedField(fieldName: string) {
        let field = (this as any)[fieldName];

        return field !== undefined && field instanceof HashedObject &&
               field.getId() === this.getDerivedFieldId(fieldName);
    }

    private getDerivedFieldId(fieldName: string) {
        return Hashing.forValue('#' + this.getId() + '.' + fieldName);
    }

    setResources(resources: Resources) : void {
        this._resources = resources;
    }

    getResources() : Resources | undefined {
        return this._resources;
    }

    toLiteralContext(context?: Context) : LiteralContext {

        if (context === undefined) {
            context = new Context();
        }

        this.toContext(context);

        return context.toLiteralContext();
    }

    toLiteral() : Literal {
        let context = this.toContext();

        return context.literals.get(context.rootHashes[0]) as Literal;
    }

    toContext(context?: Context) : Context {

        if (context === undefined) {
            context = new Context();
        }
        
        let hash = this.literalizeInContext(context, '');
        context.rootHashes.push(hash);

        return context;
    }

    literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {
        
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

        let hash = this.customHash();

        if (hash === undefined) {
            hash = Hashing.forValue(value)
        }

        let literal: Literal = { hash: hash, value: value, dependencies: Array.from(dependencies) };

        if (this.author !== undefined) {
            literal.author = value['_fields']['author']['_hash'];
        }

        if (this._signOnLiteraliz) {
            literal.signature = this.author?.sign(hash);
        } else {
            if (this.author !== undefined) {
                if (this.hasLastSignature() && this.author.verifySignature(hash, this.getLastSignature())) {
                    literal.signature = this.getLastSignature();
                }
            }
        }

        

        if (context.resources?.aliasing?.get(hash) !== undefined) {
            context.objects.set(hash, context.resources.aliasing.get(hash) as HashedObject);
        } else {
            context.objects.set(hash, this);
        }
        
        context.literals.set(hash, literal);

        this.setLastHash(hash);

        return hash;
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

    static literalizeField(fieldPath: string, something: any, context?: Context) : { value: any, dependencies : Set<Dependency> }  {

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
                const hset = something as HashedSet<any>;
                const hsetLiteral = hset.literalize(fieldPath, context);
                value = hsetLiteral.value;
                HashedObject.collectChildDeps(dependencies, hsetLiteral.dependencies);
            } else if (something instanceof HashedMap) {
                const hmap = something as HashedMap<any, any>;
                const hmapLiteral = hmap.literalize(fieldPath, context);
                value = hmapLiteral.value;
                HashedObject.collectChildDeps(dependencies, hmapLiteral.dependencies);
            } else { // not a set, map or array

                if (something instanceof HashReference) {
                    let reference = something as HashReference<any>;

                    let dependency : Dependency = { path: fieldPath, hash: reference.hash, className: reference.className, type: 'reference'};
                    dependencies.add(dependency);

                    value = reference.literalize();
                } else if (something instanceof HashedObject) {
                    let hashedObject = something as HashedObject;

                    if (context === undefined) {
                        throw new Error('Context needed to deliteralize HashedObject');
                    }

                    let hash = hashedObject.literalizeInContext(context, fieldPath);

                    let dependency : Dependency = { path: fieldPath, hash: hash, className: hashedObject.getClassName(), type: 'literal'};
                    dependencies.add(dependency);

                    HashedObject.collectChildDeps(dependencies, new Set((context.literals.get(hash) as Literal).dependencies));

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


    static fromLiteralContext(literalContext: LiteralContext, hash?: Hash, validate=false) : HashedObject {

        let context = new Context();
        context.fromLiteralContext(literalContext);

        return HashedObject.fromContext(context, hash, validate);
    }

    
    static fromLiteral(literal: Literal, validate=false) : HashedObject {

        let context = new Context();
        context.rootHashes.push(literal.hash);
        context.literals.set(literal.hash, literal);

        return HashedObject.fromContext(context, undefined, validate);

    }

    // Note: If validate=true, then all the HashReferences present in all the literals that
    //       need to be deliteralized to re-create the root object MUST be present in
    //       context.objects, since they are necessary for validation.
    static fromContext(context: Context, hash?: Hash, validate=false) : HashedObject {

        if (hash === undefined) {
            if (context.rootHashes.length === 0) {
                throw new Error('Cannot deliteralize object because the hash was not provided, and there are no hashes in its literal representation.');
            } else if (context.rootHashes.length > 1) {
                throw new Error('Cannot deliteralize object because the hash was not provided, and there are more than one hashes in its literal representation.');
            }
            hash = context.rootHashes[0];
        }

        HashedObject.deliteralizeInContext(hash, context, validate);

        return context.objects.get(hash) as HashedObject;
    }

    // deliteralizeInContext: take the literal with the given hash from the context,
    //                        recreate the object and insert it into the context
    //                        (be smart and only do it if it hasn't been done already)

    static deliteralizeInContext(hash: Hash, context: Context, validate=false) : void {

        let hashedObject = context.objects.get(hash);

        if (hashedObject !== undefined) {
            return;
        }

        // check if we can extract the object from the shared context
        let sharedObject = context?.resources?.aliasing?.get(hash);

        if (sharedObject !== undefined) {
            context.objects.set(hash, sharedObject);
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
            throw new Error("A local implementation of class '" + value['_class'] + "' is necessary to deliteralize " + literal.hash);
        } else {
            hashedObject = new constr();
        }

        for (const [fieldName, fieldValue] of Object.entries(value['_fields'])) {
            if (fieldName.length>0 && fieldName[0] !== '_') {
                (hashedObject as any)[fieldName] = HashedObject.deliteralizeField(fieldValue, context, validate);
            }
        }

        if (context.resources !== undefined) {
            hashedObject.setResources(context.resources);
        }
        
        hashedObject.setLastHash(hash);

        if (validate) {

            if (hashedObject.author !== undefined) {
                if (literal.signature === undefined) {
                    throw new Error('Singature is missing for object ' + hash);
                }

                if (!hashedObject.author.verifySignature(hash, literal.signature)) {
                    throw new Error('Invalid signature for obejct ' + hash);
                }
            }

            if (!hashedObject.validate(context.objects)) {
                throw new Error('Validation failed for object ' + hash);
            }

        }

        hashedObject.init();


        // check object signature if author is present
        if (hashedObject.author !== undefined) {

            // validation is asked for explicitly now, so the following does not 
            // belong here:

            /*
            if (literal.signature === undefined) {
                throw new Error('Singature is missing for object ' + hash);
            }

            if (!hashedObject.author.verifySignature(hash, literal.signature)) {
                throw new Error('Invalid signature for obejct ' + hash);
            }
            */

            hashedObject.setLastSignature(literal.signature as string);
        }

        context.objects.set(hash, hashedObject);
    }

    static deliteralizeField(value: any, context: Context, validate=false) : any  {

        let something: any;

        let typ = typeof(value);

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            something = value;
        } else if (typ === 'object') {
            if (Array.isArray(value)) {
                something = [];
               for (const elmt of value) {
                   something.push(HashedObject.deliteralizeField(elmt, context, validate));
               }
            } else if (value['_type'] === undefined) {
                something = {} as any;

                for (const [fieldName, fieldValue] of Object.entries(value)) {
                    something[fieldName] = HashedObject.deliteralizeField(fieldValue, context, validate);
                }
            } else {
                if (value['_type'] === 'hashed_set') {
                    something = HashedSet.deliteralize(value, context, validate);
                } else if (value['_type'] === 'hashed_map') { 
                    something = HashedMap.deliteralize(value, context);
                } else if (value['_type'] === 'hashed_object_reference') {
                    something = HashReference.deliteralize(value);
                } else if (value['_type'] === 'hashed_object_dependency') {
                    let hash = value['_hash'];

                    HashedObject.deliteralizeInContext(hash, context, validate);
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

    static generateIdForPath(parentId: string, path: string) {
        return Hashing.forValue('#' + parentId + '.' + path);
    }

    static hashElement(element: any) : Hash {

        let hash: Hash;

        if (element instanceof HashedObject) {
            hash = (element as HashedObject).hash();
        } else {
            hash = Hashing.forValue(HashedObject.literalizeField('', element).value);
        }

        return hash;
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

export { HashedObject, Literal, Dependency };