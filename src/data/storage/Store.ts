import { Backend, BackendSearchParams, BackendSearchResults } from 'data/storage/Backend'; 
import { HashedObject, MutableObject, Literal, Dependency, AliasingContext, Context } from 'data/model.ts';
import { Hash } from 'data/model/Hashing';
import { RSAKeyPair } from 'data/identity/RSAKeyPair';
import { Identity } from 'data/identity/Identity';

import { MultiMap } from 'util/multimap';

type PackedFlag   = 'mutable'|'op'|'reversible'|'undo';
type PackedLiteral = { hash : Hash, value: any, author?: Hash, signature?: string,
                       dependencies: Array<Dependency>, flags: Array<PackedFlag> };

type LoadParams = BackendSearchParams;

class Store {

    private backend : Backend;

    private classCallbacks : MultiMap<string, (match: Hash) => Promise<void>>;
    private referencesCallbacks : MultiMap<string, (match: Hash) => Promise<void>>;
    private classReferencesCallbacks : MultiMap<string, (match: Hash) => Promise<void>>;

    constructor(backend : Backend) {
        this.backend = backend;

        this.classCallbacks = new MultiMap();
        this.referencesCallbacks = new MultiMap();
        this.classReferencesCallbacks = new MultiMap();
    }

    async save(object: HashedObject) : Promise<void>{
        let context = object.toContext();
        let hash    = context.rootHash as Hash;
        //let context = { rootHash: hash, literals: literalContext.literals, objects: new Map() };

        await this.saveWithContext(hash, context);

        if (object instanceof MutableObject) {
            await object.saveQueuedOps();
        }
    }

    private async saveWithContext(hash: Hash, context: Context) : Promise<void> {

        // TODO: we could keep a set of hashes already saved by previous calls to
        //       saveWithContext in this same recursion, and skip them without
        //       having to call this.load(hash).

        let loaded = await this.load(hash);

        if (loaded !== undefined) {
            return Promise.resolve();
        }

        let literal = context.literals.get(hash);

        if (literal === undefined) {
            throw new Error('Hash ' + hash + ' is missing from context received for saving');
        }

        for (let dependency of literal.dependencies) {
            if (dependency.type === 'literal') {
                await this.saveWithContext(dependency.hash, context);
            }
        }

        let packed = await this.packLiteral(literal, context);

        await this.backend.store(packed);

        let object = context.objects.get(literal.hash) as HashedObject;

        if ( !object.hasStore() ) {
            object.setStore(this);
        }

        // after the backend has stored the object, fire callbacks:
        await this.fireCallbacks(literal);
    }
    

    private async fireCallbacks(literal: Literal) : Promise<void> {

        // fire watched classes callbacks
        for (const key of this.classCallbacks.keys()) {
            let className = Store.classForkey(key);

            if (literal.value['_class'] === className) {
                for (const callback of this.classCallbacks.get(key)) {
                    await callback(literal.hash);
                }
            }
        }

        // fire watched references callbacks
        for (const key of this.referencesCallbacks.keys()) {
            let reference = Store.referenceForKey(key);

            for (const dep of literal.dependencies) {
                if (dep.path === reference.path && dep.hash === reference.hash) {
                    for (const callback of this.referencesCallbacks.get(key)) {
                        await callback(literal.hash);
                    }
                }
            }
        }

        // fire watched class+reference pair callbacks
        for (const key of this.classReferencesCallbacks.keys()) {
            let classReference = Store.classReferenceForKey(key);

            if (classReference.className === literal.value['_class']) {
                for (const dep of literal.dependencies) {
                    if (dep.path === classReference.path && dep.hash === dep.hash) {
                        for (const callback of this.classReferencesCallbacks.get(key)) {
                            await callback(literal.hash);
                        }
                    }
                }    
            }

        }

    }

    /*async pack(object: HashedObject) {
        let packed = await this.packLiteral(object.toLiteral());

        return packed;
    }*/

    private async packLiteral(literal: Literal, context: Context) {
        let packed = {} as PackedLiteral;

        packed.hash  = literal.hash;
        packed.value = literal.value;
        
        if (literal.author !== undefined) {
            packed.author = literal.author;
            let author = context.objects.get(literal.author) as Identity;
            let keyHash = author.getKeyPairHash();
            let key     = await (this.load(keyHash) as Promise<RSAKeyPair>);
            packed.signature = key.sign(packed.hash);
        }

        packed.dependencies = Array.from(literal.dependencies);
        
        packed.flags = literal.value['_flags'];
        
        return packed;
    }

    async load(hash: Hash, aliasingContext?: AliasingContext) : Promise<HashedObject | undefined> {

        let context : Context = { aliased: aliasingContext?.aliased,
                                  objects: new Map<Hash, HashedObject>(),
                                  literals: new Map<Hash, Literal>() };

        if (context.aliased === undefined) {
            context.aliased = new Map();
        }

        return this.loadWithContext(hash, context);
    }

    private async loadWithContext(hash: Hash, context: Context) : Promise<HashedObject | undefined> {

        let obj = context.objects.get(hash);

        if (obj === undefined) {

            // load object's literal and its dependencies' literals into the context, if necessary

            let literal = context.literals.get(hash);
            if (literal === undefined) {
                literal = await this.loadLiteral(hash);

                if (literal === undefined) {
                    return undefined;
                }

                context.literals.set(literal.hash, literal);
            }

            for (let dependency of literal.dependencies) {
                if (dependency.type === 'literal') {
                    if (context.aliased?.get(dependency.hash) === undefined &&
                        context.objects.get(dependency.hash)  === undefined && 
                        context.literals.get(dependency.hash) === undefined) {

                        // NO NEED to this.loadLiteralWithContext(depLiteral as Literal, context)
                        // because all transitive deps are in object deps.

                        let depLiteral = await this.loadLiteral(dependency.hash);                            
                        context.literals.set(dependency.hash, depLiteral as Literal);
                    }
                }
            }

            // use the context to create the object from all the loaded literals

            let newContext = { rootHash: literal.hash, objects: context.objects, literals: context.literals };
            obj = HashedObject.fromContext(newContext);

            for (const ctxObj of context.objects.values()) {
                if (!ctxObj.hasStore()) {
                    ctxObj.setStore(this);
                }
            }
        }

        return obj;
    }

    async loadByClass(className: string, params?: LoadParams) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let searchResults = await this.backend.searchByClass(className, params);

        return this.unpackSearchResults(searchResults);

    }

    async loadByReference(referringPath: string, referencedHash: Hash, params?: LoadParams) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let searchResults = await this.backend.searchByReference(referringPath, referencedHash, params);

        return this.unpackSearchResults(searchResults);
    }

    async loadByReferencingClass(referringClassName: string, referringPath: string, referencedHash: Hash, params?: LoadParams) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let searchResults = await this.backend.searchByReferencingClass(referringClassName, referringPath, referencedHash, params);

        return this.unpackSearchResults(searchResults);
    }

    private async loadLiteral(hash: Hash) : Promise<Literal | undefined> {

        let packed = await this.backend.load(hash);
        
        if (packed === undefined) {
            return undefined;
        } else {
            return this.unpackLiteral(packed);
        }
       
    }

    private unpackLiteral(packed: PackedLiteral) : Literal {
        let literal = {} as Literal;

        literal.hash = packed.hash;
        literal.value = packed.value;
        literal.dependencies = new Set<Dependency>(packed.dependencies);
        if (packed.author !== undefined) {
            literal.author = packed.author;
        }
        literal.value['_flags'] = packed.flags;

        return literal;
    }

    private async unpackSearchResults(searchResults: BackendSearchResults) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let context : Context = { objects: new Map<Hash, HashedObject>(),
                                  literals: new Map<Hash, Literal>() };

        let objects = [] as Array<HashedObject>;
        
        for (let packed of searchResults.items) {

            context.literals.set(packed.hash, this.unpackLiteral(packed));

            let obj = await this.loadWithContext(packed.hash, context) as HashedObject;
            objects.push(obj);
        }

        return {objects: objects, start: searchResults.start, end: searchResults.end};    
    }

    async loadTerminalOpsForMutable(hash: Hash) 
            : Promise<{lastOp?: Hash, terminalOps: Array<Hash>} | undefined> {
        
        let info = await this.backend.loadTerminalOpsForMutable(hash);

        return info;
    }

    async loadClosure(init: Set<Hash>, next: (obj: HashedObject) => Set<Hash>, aliasingContext?: AliasingContext | undefined) : Promise<Set<Hash>> {

        let closure = new Set<Hash>();
        let pending = new Set<Hash>(init);


        
        while (pending.size > 0) {
            let {done, value} = pending.values().next(); done;
            pending.delete(value);
            closure.add(value);

            let obj = await this.load(value, aliasingContext) as HashedObject;
            let children = next(obj);

            for (const hash of children.values()) {
                if (!closure.has(hash)) {
                    pending.add(hash);
                }
            }
        }

        return closure;
    }

    watchClass(className: string, callback: (match: Hash) => Promise<void>) {
        const key = Store.keyForClass(className);
        this.classCallbacks.add(key, callback);
    }

    watchReferences(referringPath: string, referencedHash: Hash, callback: (match: Hash) => Promise<void>) {
        const key = Store.keyForReference(referringPath, referencedHash);
        this.referencesCallbacks.add(key, callback);
    }

    watchClassReferences(referringClassName: string, referringPath: string, referencedHash: Hash, callback: (match: Hash) => Promise<void>) {
        const key = Store.keyForClassReference(referringClassName, referringPath, referencedHash);
        this.classReferencesCallbacks.add(key, callback);
    }

    removeClassWatch(className: string, callback: (match: Hash) => Promise<void>) : boolean {
        const key = Store.keyForClass(className);
        return this.classCallbacks.remove(key, callback);
    }

    removeReferencesWatch(referringPath: string, referencedHash: Hash, callback: (match: Hash) => Promise<void>) : boolean {
        const key = Store.keyForReference(referringPath, referencedHash);
        return this.referencesCallbacks.remove(key, callback);
    }

    removeClassReferencesWatch(referringClassName: string, referringPath: string, referencedHash: Hash, callback: (match: Hash) => Promise<void>) : boolean {
        const key = Store.keyForClassReference(referringClassName, referringPath, referencedHash);
        return this.classReferencesCallbacks.remove(key, callback);
    }

    private static keyForClass(className: string) {
        return className;
    }

    private static keyForReference(referringPath: string, referencedHash: Hash) {
        return referringPath + '#' + referencedHash;
    }

    private static keyForClassReference(referringClassName: string, referringPath: string, referencedHash: Hash) {
        return referringClassName + '->' + referringPath + '#' + referencedHash;
    }

    private static classForkey(key: string) {
        return key;
    }

    private static referenceForKey(key: string) {
        let parts = key.split('#');
        return { path: parts[0], hash: parts[1] };
    }

    private static classReferenceForKey(key: string) {
        let parts = key.split('->');
        let className = parts[0];
        let result = Store.referenceForKey(parts[1]) as any;
        result['className'] = className;

        return result as {className: string, path: string, hash: Hash};
    }
}

export { Store, PackedLiteral };