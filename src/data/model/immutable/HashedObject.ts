import { Store } from 'storage/store';

import { RNGImpl } from 'crypto/random';

import { Identity } from '../../identity/Identity';

import { Hashing, Hash } from '../hashing/Hashing';
import { Serialization } from '../hashing/Serialization';

import { HashedSet } from './HashedSet';
import { HashReference } from './HashReference';
import { HashedMap } from './HashedMap';

import { Context, LiteralContext } from '../literals/Context';

import { Mesh } from 'mesh/service';
import { Resources } from 'spaces/spaces';

import { Literal, Dependency } from '../literals/LiteralUtils';
import { Logger, LogLevel } from 'util/logging';
import { ClassRegistry } from '../literals/ClassRegistry';
import { EventRelay } from 'util/events';

import { MutationObserver } from '../mutable';
import { BigIntParser } from '../literals';

const BITS_FOR_ID = 128;

/* HashedObject: Base class for objects than need to be storable in the
                 Hyper Hyper Space content-addressed database.

 Defines how an object will be serialized, hashed, who it was authored by,
 whether it needs an id (randomized or derived from a parent object's id)
 and which objects should be preloaded when loading operations that mutate
 this object and its subobjects. */

abstract class HashedObject {

    // This method is deprecated, use the registry directly.
    static registerClass(name: string, clazz: new () => HashedObject) {
        ClassRegistry.register(name, clazz);
    }
    
    static validationLog = new Logger('validation', LogLevel.DEBUG);

    private id?     : string;
    private author? : Identity;
    
    private _derivedFields   : Set<string>;
    private _signOnSave      : boolean;
    private _lastSignature?  : string;
    private _lastLiteral?    : Literal;
    private _lastCustomHash? : Hash;

    private _resources? : Resources;

    // while this object is immutable, its fields may be mutable, hence:
    protected _boundToStore : boolean;
    protected _mutationEventSource?: EventRelay<HashedObject>;
    protected _cascadeMutableContentEvents: boolean;

    constructor() {
        this._derivedFields = new Set();
        this._signOnSave = false;
        this._boundToStore = false;
        this._cascadeMutableContentEvents = true;
    } 

    abstract getClassName() : string;

    abstract init() : void;
    abstract validate(references: Map<Hash, HashedObject>) : Promise<boolean>;

    getId(): (string | undefined) {
        return this.id;
    }

    setId(id: string) {
        this.id = id;
        this._lastLiteral = undefined;
        
        for (const fieldName of this._derivedFields) {
            const obj = (this as any)[fieldName];
            obj?.setId(this.getDerivedFieldId(fieldName));
        }
    }

    protected setRandomId() {
        //TODO: use b64 here
        this.setId(new RNGImpl().randomHexString(BITS_FOR_ID));
    }

    hasId(): boolean {
        return this.id !== undefined;
    }

    setAuthor(author: Identity) {
        
        //if (!author.hasKeyPair()) {
        //    throw new Error('Trying to set the author of an object, but the received identity does not have an attached key pair to sign it.');
        //}

        // Note: There are legitimate uses for setting the author to an identity whose
        //       keypair is not known (e.g., figuring out what such an object's hash
        //       would be).

        this.author = author;

        if (author !== undefined) {
            this._signOnSave = true;
        }
    }

    getAuthor() {
        return this.author;
    }

    hasAuthor() {
        return this.author !== undefined;
    }

    hasLastSignature() : boolean {
        return this._lastSignature !== undefined;
    }

    setLastSignature(signature: string) : void {
        this._lastSignature = signature;
        this._lastLiteral   = undefined;
    }

    getLastSignature() : string {
        if (this._lastSignature === undefined) {
            throw new Error('Attempted to retrieve last signature for unsigned object');
        }

        return this._lastSignature;
    }

    protected overrideChildrenId() : void {
        for (const fieldName of Object.keys(this)) {
            if (fieldName.length > 0 && fieldName[0] !== '_') {
                let value = (this as any)[fieldName];
                if (value instanceof HashedObject) {
                    this.overrideIdForPath(fieldName, value);
                }
            }
        }
    }

    protected overrideIdForPath(path: string, target: HashedObject) : void {
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
            throw new Error('Attempted to get store from object resources, but one is not present in instance of ' + this.getClassName());
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

    hasLastLiteral() {
        return this._lastLiteral !== undefined;
    }

    getLastLiteral() {
        return this._lastLiteral;
    }

    setLastLiteral(literal: Literal) {
        this._lastLiteral = literal;
    }

    shouldSignOnSave() {
        return this._signOnSave;
    }

    hasLastHash() {
        return this._lastLiteral?.hash !== undefined;
    }

    getLastHash() {
        
        if (this._lastCustomHash === undefined && this._lastLiteral === undefined) {
            this.hash();
        }

        if (this._lastCustomHash !== undefined) {
            return this._lastCustomHash;
        } else {
            return (this._lastLiteral as Literal).hash;
        }
    }
  
    hash(seed?: string): Hash {

        //console.log('about to hash a ' + this.getClassName())
        //console.trace();

        let hash = this.customHash(seed);

        if (hash === undefined) {
            let context = this.toContext();
            if (seed === undefined) {
                hash = context.rootHashes[0] as Hash;
            } else {
                let literal = context.literals.get(context.rootHashes[0]) as Literal;
                hash = Hashing.forValue(literal.value, seed);
            }
        } else {
            if (seed === undefined) {
                this._lastCustomHash = hash;
            }
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

    equalsUsingLastHash(another: HashedObject | undefined) {

        return another !== undefined && this.getLastHash() === another.getLastHash();
    }

    clone() : this {
        const c = this.toContext();
        
        const current = c.objects;

        c.objects = new Map<Hash, HashedObject>();

        let clone = HashedObject.fromContext(c) as this;

        for (const [hash, obj] of current.entries()) {
            const clonedObj = c.objects.get(hash) as HashedObject;
            clonedObj._signOnSave    = obj._signOnSave;
            clonedObj._lastSignature = obj._lastSignature;
        }

        return clone;
    }

    protected addDerivedField(fieldName: string, object?: HashedObject) {
        this._derivedFields.add(fieldName);

        // to keep backwards compat for now:
        if (object !== undefined) {
            this.setDerivedField(fieldName, object);
        }
    }

    protected setDerivedField(fieldName: string, object: HashedObject) {

        if (!this._derivedFields.has(fieldName)) {
            throw new Error('Trying to set the value of a derived field that was not added. Add derived fields (independently of they being set) to ensure the correct behaviour of setId on loaded objects.');
        }

        object.setId(this.getDerivedFieldId(fieldName));
        (this as any)[fieldName] = object;
    }

    checkDerivedField(fieldName: string) {
        let field = (this as any)[fieldName];

        return field !== undefined && field instanceof HashedObject &&
               field.getId() === this.getDerivedFieldId(fieldName);
    }

    getDerivedFieldId(fieldName: string) {
        return Hashing.forValue('#' + this.getId() + '.' + fieldName);
    }

    setResources(resources: Resources): void {
        if (this._resources === resources) return;

        this._resources = resources;

        for (const subobj of this.getDirectSubObjects().values()) {
            subobj.setResources(resources);
        }
    }

    getResources(): Resources | undefined {
        return this._resources;
    }

    hasResources(): boolean {
        return this._resources !== undefined;
    }

    forgetResources(): void {
        this._resources = undefined;

        for (const subobj of this.getDirectSubObjects().values()) {
            subobj.forgetResources();
        }
    }

    forgetCachedLiterals(): void {
        this._lastLiteral = undefined;

        for (const subobj of this.getDirectSubObjects().values()) {
            subobj.forgetCachedLiterals();
        }
    }

    getMutationEventSource(): EventRelay<HashedObject> {

        if (this._mutationEventSource === undefined) {

            this._mutationEventSource = this.createMutationEventSource();
            
        }

        return this._mutationEventSource;

    }

    protected createMutationEventSource(): EventRelay<HashedObject> {

        const subObservers = new Map<string, EventRelay<HashedObject>>();

        for (const [fieldName, subobj] of this.getDirectSubObjects().entries()) {
            //if (!seen.has(subobj)) {
            //    console.log('adding subobject ' + fieldName + ' to ' + this.getLastHash() + '( a ' + this.getClassName() + ')');
                subObservers.set(fieldName, subobj.getMutationEventSource());
            //} else {
            //    console.log('NOT adding subobject ' + fieldName + ' to ' + this.getLastHash() + '( a ' + this.getClassName() + ')');
            //}
        }

        return new EventRelay(this, subObservers);
    }

    addObserver(obs: MutationObserver) {
        this.getMutationEventSource().addObserver(obs);
    }

    removeObserver(obs: MutationObserver) {
        this._mutationEventSource?.removeObserver(obs);
    }

    cascadeMutableContentEvents() {
        return this.toggleCascadeMutableContentEvents(true);
    }

    dontCascadeMutableContentEvents() {
        return this.toggleCascadeMutableContentEvents(false);
    }

    isCascadingMutableContentEvents() {
        return this._cascadeMutableContentEvents;
    }

    toggleCascadeMutableContentEvents(enabled: boolean): boolean {

        const before = this._cascadeMutableContentEvents;
        
        this._cascadeMutableContentEvents = enabled;

        for (const subobj of this.getDirectSubObjects().values()) {
            if (subobj instanceof HashedObject) {
                subobj.toggleCascadeMutableContentEvents(enabled);
            }
        }

        return before;
    }

    getSubObjects(context?: Context, direct=false): Map<string, HashedObject> {
        
        let literal: Literal;

        if (context === undefined) {
            context = this.toContext();
            literal = context.literals.get(context.rootHashes[0]) as Literal;
        } else {
            literal = context.literals.get(this.hash()) as Literal;
        }
        
        const subobjs = new Map();

        for (const dep of literal.dependencies) {

            if (dep.type === 'literal') {

                if (direct && !dep.direct) {
                    continue;
                }

                const subobj = context.objects.get(dep.hash);
                subobjs.set(dep.path, subobj);
    
                /*let path = undefined;
                let subobj = this;
    
                for (const part of dep.path.split('.')) {
                    if (path === undefined) {
                        path = '';
                    } else {
                        path = path + '.';
                    }
                    path = path + part;
                    const old = subobj;
    
                    subobj = (subobj as any)[part];
                    if (subobj === undefined) {
                        console.log(part);
                        console.log(old);
                        console.log(this.getClassName());
                        console.log(this);
                        console.log(literal);
                    }
                    if (subobj instanceof HashedObject) {
                        subobjs.set(path, subobj);
                        break;
                    }
                }*/
            }

            
        }

        return subobjs;
    }

    static collectDirectSubobjects(path: string, value: any, subobjects: Map<string, HashedObject>, references: Map<Hash, HashReference<HashedObject>>) {

        //console.log('called collectDirectSubobjects() w/path', path, 'subobjects: ', subobjects.size);
        //console.log(new Error().stack);

        let typ = typeof(value);
        
        // We're only concerned with 'object' typed stuff, since scalars, strings, etc. cannot yield
        // any HashedObject-derived subobjects.

        if (typ === 'object') {
            if (value instanceof HashedObject) {
                subobjects.set(path, value);
            } else if (Array.isArray(value)) {
                for (const [idx, elmt] of value.entries()) {
                    HashedObject.collectDirectSubobjects(path + '[' + idx + ']', elmt, subobjects, references);
                }
            } else if (value instanceof HashedSet) {
                for (const [hash, elmt] of value.entries()) {
                    HashedObject.collectDirectSubobjects(path + '[' + hash + ']', elmt, subobjects, references);
                }
            } else if (value instanceof HashedMap) {
                for (const [key, elmt] of value.entries()) {
                    HashedObject.collectDirectSubobjects(path + '[' + key + ']', elmt, subobjects, references);
                }
            } else if (value instanceof HashReference) {
                references.set(path, value);
            } else { // value is a plain object dictionary
                for (const fieldName of Object.keys(value)) {

                    let fieldValue = (value as any)[fieldName];

                    const sep = fieldName.length > 0 && path.length > 0? '.' : '';
                    const newPath = path + sep + fieldName;

                    HashedObject.collectDirectSubobjects(newPath, fieldValue, subobjects, references);                    
                }
            }
        }
    }

    getDirectSubObjects(): Map<string, HashedObject> {
        return this.getDirectSubObjectsAndReferences().objects;
    }

    getDirectSubObjectsAndReferences(): { objects: Map<Hash, HashedObject>, references: Map<Hash, HashReference<HashedObject>> } {

        //return this.getSubObjects(context, true);

        const subobjects = new Map<Hash, HashedObject>();
        const references = new Map<Hash, HashReference<HashedObject>>();
        const objectKeys = Object.keys(this)
        // console.log('getDirectSubObjects: iterating over', objectKeys.length, 'keys')
        for (const fieldName of objectKeys) {
            if (fieldName.length > 0 && fieldName[0] !== '_') {
                // console.log('getDirectSubObjects', fieldName, this)
                let value = (this as any)[fieldName];

                HashedObject.collectDirectSubobjects(fieldName, value, subobjects, references);
            }
        }

        return { objects: subobjects, references: references };

        /*
        let literal: Literal;

        if (context === undefined) {
            context = this.toContext();
            literal = context.literals.get(context.rootHashes[0]) as Literal;
        } else {
            literal = context.literals.get(this.hash()) as Literal;
        }
        
        const subobjs = new Map();

        for (const dep of literal.dependencies) {

            if (dep.path.indexOf('.') < 0) {
                const subobj = (this as any)[dep.path];
                subobjs.set(dep.path, subobj);
            }
        }

        return subobjs;*/
    }

    toLiteralContext(context?: Context): LiteralContext {

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

    addReferencesToContext(context: Context, references: Map<Hash, HashedObject>) : Context {

        const lit = context.literals.get(this.getLastHash()) as Literal;

        for (const dep of lit?.dependencies) {
            if (dep.direct) {

                if (dep.type === 'literal') {
                    const subobj = context.objects.get(dep.hash);

                    if (subobj === undefined) {
                        throw new Error('Trying to add references to context but subobject ' + dep.hash + ' (' + dep.path + ') is missing for ' + lit.hash);
                    }
    
                    subobj.addReferencesToContext(context, references);
                } else if (dep.type === 'reference') {
                    const ref = references.get(dep.hash);

                    if (ref !== undefined) {
                        ref.toContext(context);
                    }
                }
            }
        }

        return context;
    }

    getLastContext(context?: Context) : Context {

        if (context === undefined) {
            context = new Context();
        }

        const hash = this.getContextFromLastLiteral(context);


        context.rootHashes.push(hash);

        return context;
    }

    private getContextFromLastLiteral(context: Context): Hash {

        if (this._lastLiteral === undefined) {
            return this.literalizeInContext(context, ''); 
        } else {
            const hash = (this._lastLiteral as Literal).hash;

            if (context.resources?.aliasing?.get(hash) !== undefined) {
                context.objects.set(hash, context.resources.aliasing.get(hash) as HashedObject);
            } else {
                context.objects.set(hash, this);
            }
            
            context.literals.set(hash, this._lastLiteral);
    
            for (const subobj of this.getDirectSubObjects().values()) {
                subobj.getContextFromLastLiteral(context);
            }

            return hash;
        }
    }

    getLastLiteralContext() {
        return this.getLastContext().toLiteralContext();
    }

    literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {
        
        let fields = {} as any;
        let dependencies = new Map<string, Dependency>();

        for (const fieldName of Object.keys(this)) {
            if (fieldName.length > 0 && fieldName[0] !== '_') {
                let value = (this as any)[fieldName];

                if (HashedObject.shouldLiteralizeField(value)) {
                    let fieldLiteral = HashedObject.literalizeField(fieldName, value, context);
                    fields[fieldName] = fieldLiteral.value;
                    HashedObject.collectChildDeps(dependencies, path, fieldLiteral.dependencies, true);
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

        Object.freeze(fields);
        Object.freeze(value);

        let hash = this.customHash();

        let hashed = false;

        if (hash === undefined) {

            const serial = Serialization.default(value);

            if (this._lastLiteral !== undefined && Serialization.default(this._lastLiteral.value) === serial) {
                hash = this._lastLiteral.hash;
            } else {
                hash = Hashing.forString(serial);
                hashed = true;
            }
        }

        let literal: Literal = { hash: hash, value: value, dependencies: Array.from(dependencies.values()) };

       /*for (const dep of dependencies.values()) {
            if (dep.hash === 'aIhvrwQ1g7dbZ1Gvzijz/VnJjVo=') {
                console.log('found aIhvrwQ1g7dbZ1Gvzijz/VnJjVo= (' + dep.className + ') as a dep of ' + hash + ' (' +  literal.value._class + ')!!!!')
                console.log(dep);

            }
        }*/

        if (this.author !== undefined) {
            literal.author = value['_fields']['author']['_hash'];
        }

        // if we have a signature, we add it to the literal
        if (this.author !== undefined && this.hasLastSignature()) {
            literal.signature = this.getLastSignature();
        }

        if (context.resources?.aliasing?.get(hash) !== undefined) {
            context.objects.set(hash, context.resources.aliasing.get(hash) as HashedObject);
        } else {
            context.objects.set(hash, this);
        }
        
        context.literals.set(hash, literal);

        if (hashed) {
            this.setLastLiteral(literal);
        }

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

    static literalizeField(fieldPath: string, something: any, context?: Context) : { value: any, dependencies : Map<string, Dependency> }  {

        let typ = typeof(something);

        let value;
        let dependencies = new Map<string, Dependency>();

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            value = something;
        } else if (typ === 'bigint') { 
            value = BigIntParser.literalize(something);
        } else if (typ === 'object') {
            if (Array.isArray(something)) {
                value = [];
                
                for (const elmt of something) {
                    if (HashedObject.shouldLiteralizeField(elmt)) {
                        let child = HashedObject.literalizeField('', elmt, context); // should we put the index into the path? but then we can't reuse this code for sets...
                        value.push(child.value);
                        HashedObject.collectChildDeps(dependencies, fieldPath, child.dependencies, true);
                    }
                }
            } else if (something instanceof HashedSet) {
                const hset = something as HashedSet<any>;
                const hsetLiteral = hset.literalize('', context);
                value = hsetLiteral.value;
                HashedObject.collectChildDeps(dependencies, fieldPath, hsetLiteral.dependencies, true);
            } else if (something instanceof HashedMap) {
                const hmap = something as HashedMap<any, any>;
                const hmapLiteral = hmap.literalize('', context);
                value = hmapLiteral.value;
                HashedObject.collectChildDeps(dependencies, fieldPath, hmapLiteral.dependencies, true);
            } else { // not a set, map or array

                if (something instanceof HashReference) {
                    let reference = something as HashReference<any>;

                    let dependency : Dependency = { path: fieldPath, hash: reference.hash, className: reference.className, type: 'reference', direct: true};
                    dependencies.set(HashedObject.dependencyKey(dependency), dependency);

                    value = reference.literalize();
                } else if (something instanceof HashedObject) {
                    let hashedObject = something as HashedObject;

                    if (context === undefined) {
                        throw new Error('Context needed to literalize HashedObject');
                    }

                    let hash = hashedObject.literalizeInContext(context, '');

                    let dependency : Dependency = { path: fieldPath, hash: hash, className: hashedObject.getClassName(), type: 'literal', direct: true};
                    dependencies.set(HashedObject.dependencyKey(dependency), dependency);

                    const hashedDeps = (context.literals.get(hash) as Literal).dependencies.map((d: Dependency)=>[HashedObject.dependencyKey(d), d] as [string, Dependency])

                    HashedObject.collectChildDeps(dependencies, fieldPath, new Map(hashedDeps), false);

                    value = { _type: 'hashed_object_dependency', _hash: hash };
                } else {
                    value = {} as any;

                    for (const fieldName of Object.keys(something)) {
                        if (fieldName.length>0 && fieldName[0] !== '_') {
                            let fieldValue = (something as any)[fieldName];
                            if (HashedObject.shouldLiteralizeField(fieldValue)) {
                                let field = HashedObject.literalizeField(fieldName, fieldValue, context);
                                value[fieldName] = field.value;
                                HashedObject.collectChildDeps(dependencies, fieldPath, field.dependencies, true);
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

    static fromLiteralContextWithValidation(literalContext: LiteralContext, hash?: Hash) : Promise<HashedObject> {

        let context = new Context();
        context.fromLiteralContext(literalContext);

        return HashedObject.fromContextWithValidation(context, hash);
    }



    static fromLiteralContext(literalContext: LiteralContext, hash?: Hash) : HashedObject {

        let context = new Context();
        context.fromLiteralContext(literalContext);

        return HashedObject.fromContext(context, hash);
    }

    
    static fromLiteral(literal: Literal) : HashedObject {

        let context = new Context();
        context.rootHashes.push(literal.hash);
        context.literals.set(literal.hash, literal);

        return HashedObject.fromContext(context);

    }

    // IMPORTANT: this method is NOT reentrant / thread safe!

    static async fromContextWithValidation(context: Context, hash?: Hash, alreadyValidated=new Set<Hash>()): Promise<HashedObject> {
        if (hash === undefined) {
            if (context.rootHashes.length === 0) {
                throw new Error('Cannot deliteralize object because the hash was not provided, and there are no hashes in its literal representation.');
            } else if (context.rootHashes.length > 1) {
                throw new Error('Cannot deliteralize object because the hash was not provided, and there are more than one hashes in its literal representation.');
            }
            hash = context.rootHashes[0];
        }

        let object = context.objects.get(hash);

        if (object === undefined) {

            const literal = context.literals.get(hash);

            if (literal === undefined) {
                throw new Error('Literal for ' + hash + ' missing from context');
            }

            if (literal.hash !== hash) {
                throw new Error('Wrong hash for root object ' + hash + ', found ' + literal.hash + ' instead');
            }

            /*for (const dep of literal.dependencies) {

                if (!context.objects.has(dep.hash)) {
                    await HashedObject.fromContextWithValidation(context, dep.hash);
                }
            }*/

            object = HashedObject.fromContextInternal(context, hash, true);

            if (object.hash() !== hash) {
                throw new Error('Wrong hash for root object ' + hash + ', computed ' + object.getLastHash() + ' instead');
            }
            
            if (context.resources !== undefined) {
                object.setResources(context.resources);
            }

            await HashedObject.validateObject(object, context, alreadyValidated);
        }

        return object;
    }

    private static async validateObject(obj: HashedObject, context: Context, alreadyValidated: Set<Hash>): Promise<void> {

        const literal = context.literals.get(obj.getLastHash());

        // if this object wasn't rebuilt from a literal, no need to validate
        if (literal === undefined) {
            return;
        }

        // if already validated, skip
        if (alreadyValidated.has(obj.getLastHash())) {
            return;
        }

        /*for (const dep of literal.dependencies) {

            if (dep.direct && context.literals.has(dep.hash) && !context.objects.has(dep.hash)) {
                await HashedObject.fromContextWithValidation(context, dep.hash, done);           
            }
        }*/

        const objContents = obj.getDirectSubObjectsAndReferences()

        for (const [hash, subobj] of objContents.objects.entries()) {
            if (context.literals.has(hash)) {
                await HashedObject.validateObject(subobj, context, alreadyValidated);
            }
        }

        for (const ref of objContents.references.values()) {
            if (context.literals.has(ref.hash) && !context.objects.has(ref.hash)) {
                await HashedObject.fromContextWithValidation(context, ref.hash, alreadyValidated);
            }
        }

        if (obj.author !== undefined) {
            if (!obj.hasLastSignature()) {
                throw new Error('Missing signature for ' + obj.getLastHash() + ' of type ' + obj.getClassName());
            }

            if (!await obj.author.verifySignature(obj.getLastHash(), obj.getLastSignature())) {
                throw new Error('Invalid signature for ' + obj.getLastHash() + ' of type ' + obj.getClassName());
            }
        }

        if (!await obj.validate(context.objects)) {
            throw new Error('Validation failed for ' + obj.getLastHash() + ' of type ' + obj.getClassName());
        }
        

        alreadyValidated.add(obj.getLastHash());
    }
    
    static fromContext(context: Context, hash?: Hash) : HashedObject {
        return HashedObject.fromContextInternal(context, hash);
    }

    // do not use validate=true directly, use fromContextWithValidation

    private static fromContextInternal(context: Context, hash?: Hash, validate=false) : HashedObject {

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
        
        let constr = ClassRegistry.lookup(value['_class']);

        if (constr === undefined) {
            throw new Error("A local implementation of class '" + value['_class'] + "' is necessary to deliteralize " + literal.hash);
        } else {
            hashedObject = new constr() as HashedObject;
        }

        for (const [fieldName, fieldValue] of Object.entries(value['_fields'])) {
            if (fieldName.length>0 && fieldName[0] !== '_') {

                (hashedObject as any)[fieldName] = HashedObject.deliteralizeField(fieldValue, context, validate);
            }
        }

        if (context.resources !== undefined) {
            hashedObject.setResources(context.resources);
        }
        
        if (!validate) {
            hashedObject.setLastLiteral(literal);
        } else {
            const serial = Serialization.default(literal.value)
            const hash = Hashing.forString(serial);
            if (hash !== literal.hash) {
                throw new Error('Error validating hash: declared value is ' + literal.hash + ', computed ' + hash);
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
                if (value['_type'] === 'bigint_literal') {
                    something = BigIntParser.deliteralize(value, validate);
                } else if (value['_type'] === 'hashed_set') {
                    something = HashedSet.deliteralize(value, context, validate);
                } else if (value['_type'] === 'hashed_map') { 
                    something = HashedMap.deliteralize(value, context, validate);
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

    static hashElement(element: any) : Hash {

        let hash: Hash;

        if (element instanceof HashedObject) {
            hash = (element as HashedObject).hash();
        } else {
            hash = Hashing.forValue(HashedObject.literalizeField('', element).value);
        }

        return hash;
    }

    static collectChildDeps(parentDeps : Map<string, Dependency>, path: string, childDeps : Map<string, Dependency>, direct: boolean) {
        for (const [_hash, childDep] of childDeps.entries()) {

            const sep = childDep.path.length > 0 && path.length > 0? '.' : '';

            const newDep = {
                path: path + sep + childDep.path,
                hash: childDep.hash, 
                className: childDep.className, 
                type: childDep.type, 
                direct: childDep.direct && direct
            };
            parentDeps.set(HashedObject.dependencyKey(newDep), newDep);
        }
    }

    private static dependencyKey(dep: Dependency) {
        return dep.path + '#' + dep.hash;
    }

    static generateIdForPath(parentId: string, path: string) {
        return Hashing.forValue('#' + parentId + '.' + path);
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
                    if (!HashedObject.isLiteral(member, seen)) {
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

                    if (!HashedObject.isLiteral(value[fieldName], seen)) {
                        return false;
                    }
                }

                return true;
            }
        } else {
            return false;
        }

    }

    // load / store

    async save(store?: Store) : Promise<void> {
        if (store === undefined) {
            store = this.getStore();
        } else {
            if (this.getResources() === undefined) {
                this.setStore(store);
            }
        }

        return store.save(this);
    }

    async loadAndWatchForChanges(loadBatchSize=128): Promise<void> {

        this.watchForChanges();

        for (const obj of this.getDirectSubObjects().values()) {
            await obj.loadAndWatchForChanges(loadBatchSize);
        }
    }

    watchForChanges() {
        return this.toggleWatchForChanges(true);
    }

    dontWatchForChanges() {
        return this.toggleWatchForChanges(false);
    }

    toggleWatchForChanges(enabled: boolean): boolean {

        const before = this._boundToStore;

        this._boundToStore = enabled;

        for (const obj of this.getDirectSubObjects().values()) {
            obj.toggleWatchForChanges(enabled);
        }

        return before;
    }

    isWatchingForChanges(): boolean {
        return this._boundToStore;
    }

    async loadAllChanges(loadBatchSize=128, context = new Context()) {

        const subobjs = new Set(this.getDirectSubObjects().values());

        for (const subobj of subobjs.values()) {
            await subobj.loadAllChanges(loadBatchSize, context);
        }
    }
}

export { HashedObject };