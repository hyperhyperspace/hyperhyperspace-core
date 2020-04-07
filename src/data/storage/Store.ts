import { Backend, BackendSearchParams, BackendSearchResults } from 'data/storage/Backend'; 
import { HashedObject, MutableObject, Literal, Dependency, AliasingContext, Context } from 'data/model.ts';
import { Hash } from 'data/model/Hashing';
import { RSAKeyPair } from 'data/identity/RSAKeyPair';
import { Identity } from 'data/identity/Identity';

import { MultiMap } from 'util/multimap';

type PackedFlag   = 'mutable'|'op'|'reversible'|'undo';
type PackedLiteral = { hash : Hash, value: any, signatures : Array<[Hash, string]>,
                       dependencies: Array<Dependency>, flags: Array<PackedFlag> };

type LoadParams = BackendSearchParams;

class Store {

    private backend : Backend;

    private classCallbacks : MultiMap<string, (match: Hash) => void>;
    private referencesCallbacks : MultiMap<string, (match: Hash) => void>;
    private classReferencesCallbacks : MultiMap<string, (match: Hash) => void>;

    constructor(backend : Backend) {
        this.backend = backend;

        this.classCallbacks = new MultiMap();
        this.referencesCallbacks = new MultiMap();
        this.classReferencesCallbacks = new MultiMap();
    }

    async save(object: HashedObject) : Promise<void>{

        let literalContext = object.toLiteralContext();
        let hash    = literalContext.rootHash as Hash;
        let context = { rootHash: hash, literals: literalContext.literals, objects: new Map() };

        await this.saveWithContext(hash, context);

        object.setStore(this);

        if (object instanceof MutableObject) {
            await this.saveOperations(object);
        }
    }

    private async saveOperations(mutable: MutableObject) : Promise<void> {


        let op = mutable.nextOpToSave();
        
        while (op !== undefined) {
            try {
                await this.save(op);
                
            } catch (e) {
                mutable.failedToSaveOp(op);
                throw e;
            }
            op = mutable.nextOpToSave();
        }
    }

    private async saveWithContext(hash: Hash, context: Context) : Promise<void> {


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
        
        /*
        let prevOps = undefined;
        let obj = context.objects.get(hash);
        if (obj instanceof MutationOp) {
            prevOps = Array.from((obj as MutationOp).getPrevOps()).map((op:MutationOp) => op.hash());
        }
        */


        await this.backend.store(packed);

        // after the backend has stored the object, fire callbacks:
        this.fireCallbacks(literal);
    }
    

    private fireCallbacks(literal: Literal) {

        // fire watched classes callbacks
        for (const key of this.classCallbacks.keys()) {
            let className = Store.classForkey(key);

            if (literal.value['_class'] === className) {
                for (const callback of this.classCallbacks.get(key)) {
                    callback(literal.hash);
                }
            }
        }

        // fire watched references callbacks
        for (const key of this.referencesCallbacks.keys()) {
            let reference = Store.referenceForKey(key);

            for (const dep of literal.dependencies) {
                if (dep.path === reference.path && dep.hash === reference.hash) {
                    for (const callback of this.referencesCallbacks.get(key)) {
                        callback(literal.hash);
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
                            callback(literal.hash);
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
        packed.signatures = [];

        for (const authorHash of literal.authors) {

            let author = context.objects.get(authorHash) as Identity;
            let keyHash = author.getKeyPairHash();
            let key     = await (this.load(keyHash) as Promise<RSAKeyPair>);
            packed.signatures.push([author.hash(), key.sign(packed.hash)]);
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

    /*async unpack(packed: PackedLiteral, context: Context) : Promise<HashedObject> {
        let unpacked = await this.unpackLiteral(packed);

        return HashedObject.fromLiteral(unpacked);
    }*/

    private unpackLiteral(packed: PackedLiteral) : Literal {
        let literal = {} as Literal;

        literal.hash = packed.hash;
        literal.value = packed.value;
        literal.dependencies = new Set<Dependency>(packed.dependencies);
        literal.authors = packed.signatures.map((sig: [Hash, string]) => sig[0]);
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
            : Promise<{lastOp: Hash, terminalOps: Array<Hash>} | undefined> {
        
        let info = await this.backend.loadTerminalOpsForMutable(hash);

        return info;
    }

    watchClass(className: string, callback: (match: Hash) => void) {
        const key = Store.keyForClass(className);
        this.classCallbacks.add(key, callback);
    }

    watchReferences(referringPath: string, referencedHash: Hash, callback: (match: Hash) => void) {
        const key = Store.keyForReference(referringPath, referencedHash);
        this.referencesCallbacks.add(key, callback);
    }

    watchClassReferences(referringClassName: string, referringPath: string, referencedHash: Hash, callback: (match: Hash) => void) {
        const key = Store.keyForClassReference(referringClassName, referringPath, referencedHash);
        this.classReferencesCallbacks.add(key, callback);
    }

    removeClassWatch(className: string, callback: (match: Hash) => void) : boolean {
        const key = Store.keyForClass(className);
        return this.classCallbacks.remove(key, callback);
    }

    removeReferencesWatch(referringPath: string, referencedHash: Hash, callback: (match: Hash) => void) : boolean {
        const key = Store.keyForReference(referringPath, referencedHash);
        return this.referencesCallbacks.remove(key, callback);
    }

    removeClassReferencesWatch(referringClassName: string, referringPath: string, referencedHash: Hash, callback: (match: Hash) => void) : boolean {
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