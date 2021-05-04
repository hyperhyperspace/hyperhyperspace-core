import { Backend, BackendSearchParams, BackendSearchResults } from '../backends/Backend'; 
import { HashedObject, MutableObject, Literal, Context, HashReference, MutationOp } from 'data/model';
import { Hash } from 'data/model/Hashing';

import { MultiMap } from 'util/multimap';
import { Identity } from 'data/identity/Identity';
import { RSAKeyPair } from 'data/identity/RSAKeyPair';
import { Logger, LogLevel } from 'util/logging';

import { Resources } from 'spaces/spaces';
import { OpCausalHistory, OpCausalHistoryLiteral } from 'data/history/OpCausalHistory';

//type PackedFlag   = 'mutable'|'op'|'reversible'|'undo';
//type PackedLiteral = { hash : Hash, value: any, author?: Hash, signature?: string,
//                       dependencies: Array<Dependency>, flags: Array<PackedFlag> };

type StoredOpCausalHistory = { literal: OpCausalHistoryLiteral, computed: { height: number, size: number} };
type LoadParams = BackendSearchParams;

class Store {

    static operationLog = new Logger(MutableObject.name, LogLevel.INFO);

    static backendLoaders: Map<string, (dbName: string) => Backend> = new Map();

    static registerBackend(name: string, loader: (dbName: string) => Backend) {
        Store.backendLoaders.set(name, loader);
    }

    static load(backendName:string, dbName: string) : (Store | undefined) {

        const loader = Store.backendLoaders.get(backendName);

        if (loader === undefined) {
            return undefined;
        } else {
            return new Store(loader(dbName));
        }

    }

    private backend : Backend;

    private classCallbacks : MultiMap<string, (match: Hash) => Promise<void>>;
    private referencesCallbacks : MultiMap<string, (match: Hash) => Promise<void>>;
    private classReferencesCallbacks : MultiMap<string, (match: Hash) => Promise<void>>;

    private resources?: Resources;

    constructor(backend : Backend) {

        this.backend = backend;

        this.backend.setStoredObjectCallback(async (literal: Literal) => {
            await this.fireCallbacks(literal);
        });

        this.classCallbacks = new MultiMap();
        this.referencesCallbacks = new MultiMap();
        this.classReferencesCallbacks = new MultiMap();
    }

    // save & saveWithContext: the saving of operations is not recursive, you can't save all
    //                         operations in a mutable object that was referenced in one of
    //       (* note 1)        this object's dependencies. You need to call save explicitly
    //                         on the mutable object whose operations you want saved.

    setResources(resources: Resources) {
        this.resources = resources;
    }

    getResources() : Partial<Resources> | undefined {
        return this.resources;
    }

    async save(object: HashedObject) : Promise<void>{
        let context = object.toContext();
        let hash    = context.rootHashes[0] as Hash;

        for (const [hash, obj] of context.objects.entries()) {

            const author = obj.getAuthor();

            if (author !== undefined) {

                if (obj.shouldSignOnSave()) {

                    obj.setLastSignature(await author.sign(hash));
                    (context.literals.get(hash) as Literal).signature = obj.getLastSignature();
                }

                if (!obj.hasLastSignature()) {
                    throw new Error('Cannot save ' + hash + ', its signature is missing');
                }

            }
        }

        let missing = await this.findMissingReferencesWithContext(hash, context);

        if (missing.size > 0) {
            Store.operationLog.debug(() => 'Cannot save ' + hash + ' because the following references are missing: ' + Array.from(missing).join(', ') + '.');
            throw new Error('Cannot save object ' + hash + ' because the following references are missing: ' + Array.from(missing).join(', ') + '.');
        }

        let history: StoredOpCausalHistory | undefined = undefined; 

        if (object instanceof MutationOp) {

            const prevOpCausalHistories = new Map<Hash, OpCausalHistory>();

            if (object.prevOps !== undefined) {
                for (const hashRef of object.prevOps.values()) {
                    const prevOpHistory = await this.loadOpCausalHistory(hashRef.hash);
                    
                    if (prevOpHistory === undefined) {
                        throw new Error('Causal history of prevOp ' + hashRef.hash + ' of op ' + hash + ' is missing from store, cannot save');
                    }

                    prevOpCausalHistories.set(hashRef.hash, prevOpHistory);
                }
            }

            const opHistory = new OpCausalHistory(object, prevOpCausalHistories);
            const opComputedProps = OpCausalHistory.computeProps(prevOpCausalHistories) as {height: number, size: number};

            history = {
                literal: opHistory.literalize(),
                computed: opComputedProps
            };
        }

        Store.operationLog.debug(() => 'Saving object with hash ' + hash + ' .');
        await this.saveWithContext(hash, context, history);

        if (object instanceof MutableObject) {
            let queuedOps = await object.saveQueuedOps(); // see (* note 1) above
            if (queuedOps) {
                Store.operationLog.debug(() => 'Saved queued ops for object with hash ' + hash + ' .');
            }
        }

    }

    async findMissingReferencesWithContext(hash: Hash, context: Context, expectedClassName? : string): Promise<Set<Hash>> {

        let literal = context.literals.get(hash);

        if (literal === undefined) {
            return new Set([hash]);
        }

        if (expectedClassName !== undefined && literal.value['_class'] !== expectedClassName) {
            throw new Error('Referenced depency ' + hash + ' was found in the store with type ' + literal.value['_class'] + ' but was declared as being ' + expectedClassName + '.')
        }

        let missing = new Set<Hash>();

        for (let dependency of literal.dependencies) {

            let depHash = dependency.hash;

            let dep = context.literals.get(depHash);

            if (dep === undefined) {
                let storedDep = await this.load(depHash);

                if (storedDep === undefined) {
                    missing.add(depHash);
                } else {
                    if (storedDep.getClassName() !== dependency.className) {
                        throw new Error('Referenced depency ' + dependency.hash + ' was found in the store with type ' + storedDep.getClassName() + ' but was declared as being ' + dependency.className + ' on path ' + dependency.path + '.');
                    }
                }
            } else {
                let depMissing = await this.findMissingReferencesWithContext(dependency.hash, context, dependency.className);
                
                for (const missingHash of depMissing) {
                    missing.add(missingHash);
                }
            }
        }

        return missing;

    }

    private async saveWithContext(hash: Hash, context: Context, history?: StoredOpCausalHistory) : Promise<void> {

        // TODO: we could keep a set of hashes already saved by previous calls to
        //       saveWithContext in this same recursion, and skip them without
        //       having to call this.load(hash).

        let loaded = await this.load(hash);
        
        if (loaded === undefined) {        

            let object = context.objects.get(hash) as HashedObject;
        
            object.setStore(this);
            object.setLastHash(hash);
            let literal = context.literals.get(hash);

            if (literal === undefined) {
                throw new Error('Hash ' + hash + ' is missing from context received for saving');
            }

            for (let dependency of literal.dependencies) {
                if (dependency.type === 'literal') {
                    await this.saveWithContext(dependency.hash, context);
                }
            }

            await this.backend.store(literal, history);

        } else {
            for (const [hash, obj] of context.objects.entries()) {
                obj.setStore(this);
                obj.setLastHash(hash);
            }
        }

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

    async loadLiteral(hash: Hash): Promise<Literal | undefined> {
        return this.backend.load(hash);
    }
    
    async loadRef<T extends HashedObject>(ref: HashReference<T>) : Promise<T | undefined> {
        let obj = await this.load(ref.hash);

        if (obj !== undefined && ref.className !== obj.getClassName()) {
            throw new Error('Error loading reference to ' + ref.className + ': object with hash ' + ref.hash + ' has class ' + obj.getClassName() + ' instead.');
        }

        return obj as T | undefined;
    }

    async load(hash: Hash) : Promise<HashedObject | undefined> {

        let context = new Context();

        context.resources = this.resources;

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
                    if (context.resources?.aliasing?.get(dependency.hash) === undefined &&
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

            obj = HashedObject.fromContext(context, literal.hash);

            for (const ctxObj of context.objects.values()) {
                if (!ctxObj.hasStore()) {
                    ctxObj.setStore(this);
                }
            }

            if (obj instanceof Identity) {
                const id = obj as Identity;
                if (!id.hasKeyPair()) {
                    let kp = await this.load(id.getKeyPairHash());
                    if (kp !== undefined && kp instanceof RSAKeyPair) {
                        id.addKeyPair(kp);
                    }
                }
            }
        }

        return obj;
    }

    async loadByClass(className: string, params?: LoadParams) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let searchResults = await this.backend.searchByClass(className, params);

        return this.loadSearchResults(searchResults);

    }

    async loadByReference(referringPath: string, referencedHash: Hash, params?: LoadParams) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let searchResults = await this.backend.searchByReference(referringPath, referencedHash, params);

        return this.loadSearchResults(searchResults);
    }

    async loadByReferencingClass(referringClassName: string, referringPath: string, referencedHash: Hash, params?: LoadParams) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let searchResults = await this.backend.searchByReferencingClass(referringClassName, referringPath, referencedHash, params);

        return this.loadSearchResults(searchResults);
    }

    async loadOpCausalHistory(opHash: Hash): Promise<OpCausalHistory | undefined> {
        const stored = await this.backend.loadOpCausalHistory(opHash);

        if (stored === undefined) {
            return undefined;
        } else {
            const opCausalHistory = new OpCausalHistory(stored.literal);
            opCausalHistory._computedProps = stored.computed;
    
            return opCausalHistory;
        }

    }

    async loadOpCausalHistoryByHash(causalHistoryHash: Hash): Promise<OpCausalHistory | undefined> {
        const stored = await this.backend.loadOpCausalHistoryByHash(causalHistoryHash);

        if (stored === undefined) {
            return undefined;
        } else {
            const opCausalHistory = new OpCausalHistory(stored.literal);
            opCausalHistory._computedProps = stored.computed;
    
            return opCausalHistory;
        }

    }

    /*private async loadLiteral(hash: Hash) : Promise<Literal | undefined> {

        let packed = await this.backend.load(hash);
        
        if (packed === undefined) {
            return undefined;
        } else {

            return this.unpackLiteral(packed);
        }
       
    }*/

    /*private unpackLiteral(packed: PackedLiteral) : Literal {
        let literal = {} as Literal;

        literal.hash = packed.hash;
        literal.value = packed.value;
        literal.dependencies = new Set<Dependency>(packed.dependencies);
        if (packed.author !== undefined) {
            literal.author = packed.author;
        }
        literal.value['_flags'] = packed.flags;

        return literal;
    }*/

    private async loadSearchResults(searchResults: BackendSearchResults) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let context = new Context();

        let objects = [] as Array<HashedObject>;
        
        for (let literal of searchResults.items) {

            context.literals.set(literal.hash, literal);

            let obj = await this.loadWithContext(literal.hash, context) as HashedObject;
            objects.push(obj);
        }

        return {objects: objects, start: searchResults.start, end: searchResults.end};    
    }

    async loadTerminalOpsForMutable(hash: Hash) 
            : Promise<{lastOp?: Hash, terminalOps: Array<Hash>} | undefined> {
        
        let info = await this.backend.loadTerminalOpsForMutable(hash);

        return info;
    }

    async loadClosure(init: Set<Hash>, next: (obj: HashedObject) => Set<Hash>) : Promise<Set<Hash>> {

        let closure = new Set<Hash>();
        let pending = new Set<Hash>(init);

        while (pending.size > 0) {
            let {done, value} = pending.values().next(); done;
            pending.delete(value);
            closure.add(value);

            let obj = await this.load(value) as HashedObject;
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
        return this.classCallbacks.delete(key, callback);
    }

    removeReferencesWatch(referringPath: string, referencedHash: Hash, callback: (match: Hash) => Promise<void>) : boolean {
        const key = Store.keyForReference(referringPath, referencedHash);
        return this.referencesCallbacks.delete(key, callback);
    }

    removeClassReferencesWatch(referringClassName: string, referringPath: string, referencedHash: Hash, callback: (match: Hash) => Promise<void>) : boolean {
        const key = Store.keyForClassReference(referringClassName, referringPath, referencedHash);
        return this.classReferencesCallbacks.delete(key, callback);
    }

    getName() {
        return this.backend.getName();
    }

    getBackendName() {
        return this.backend.getBackendName();
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

export { Store, StoredOpCausalHistory };