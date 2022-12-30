import { Backend, BackendSearchParams, BackendSearchResults, Storable } from '../backends/Backend'; 
import { HashedObject, MutableObject, Literal, Context, HashReference, MutationOp, HashedSet, LiteralUtils } from 'data/model';
import { Hash } from 'data/model/hashing/Hashing';

import { MultiMap } from 'util/multimap';
import { Logger, LogLevel } from 'util/logging';
import { LRUCache } from 'util/caching';

import { Resources } from 'spaces/spaces';
import { OpHeader, OpHeaderLiteral } from 'data/history/OpHeader';
import { InvalidateAfterOp } from 'data/model/causal/InvalidateAfterOp';
import { CascadedInvalidateOp } from 'data/model/causal/CascadedInvalidateOp';
import { Identity, RSAKeyPair } from 'data/identity';

//type PackedFlag   = 'mutable'|'op'|'reversible'|'undo';
//type PackedLiteral = { hash : Hash, value: any, author?: Hash, signature?: string,
//                       dependencies: Array<Dependency>, flags: Array<PackedFlag> };

type StoredOpHeader = { literal: OpHeaderLiteral };
type LoadParams = BackendSearchParams;

type LoadResults = { objects: Array<HashedObject>, start?: string, end?: string };

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

    static extractPrevOps: (obj: HashedObject) => Set<Hash> = (obj: HashedObject) => new Set(Array.from((obj as MutationOp).getPrevOps()).map((ref: HashReference<MutationOp>) => ref.hash))

    private backend : Backend;

    private classCallbacks : MultiMap<string, (match: Hash) => Promise<void>>;
    private referencesCallbacks : MultiMap<string, (match: Hash) => Promise<void>>;
    private classReferencesCallbacks : MultiMap<string, (match: Hash) => Promise<void>>;

    private resources?: Resources;

    private keyPairs: Map<Hash, RSAKeyPair>;

    private initKeyPairs: Promise<void>;
    private cache: LRUCache<Hash, Literal>;

    constructor(backend : Backend) {

        this.backend = backend;

        this.backend.setStoredObjectCallback(async (literal: Literal) => {

            if (LiteralUtils.getClassName(literal) === RSAKeyPair.className) {
                let kp = HashedObject.fromLiteral(literal);
                this.keyPairs.set(literal.hash, kp as RSAKeyPair);
            }

            await this.fireCallbacks(literal);
        });

        this.classCallbacks = new MultiMap();
        this.referencesCallbacks = new MultiMap();
        this.classReferencesCallbacks = new MultiMap();

        this.keyPairs = new Map();

        this.initKeyPairs = this.doInitKeypairs();
        this.cache = new LRUCache(1024);

        this.cache.evict('a');
    }

    private async doInitKeypairs() {

        const results = await this.loadByClass(RSAKeyPair.className);

        for (const kp of results.objects as Array<RSAKeyPair>) {
            this.keyPairs.set(kp.getLastHash(), kp);
        }
    }

    setResources(resources: Resources) {
        this.resources = resources;
    }

    getResources() : Partial<Resources> | undefined {
        return this.resources;
    }

    // save: The saving of operations is not recursive.
    //
    //                         If an operation is itself mutable, you need to call save() again
    //       (* note 1)        on the operation if you want its mutations flushed to the database
    //                         as well. (All mutable dependencies are flushed if required - this
    //                         applies only to their mutation ops)

    async save(object: HashedObject, saveMutations=true) : Promise<void> {
        let context = object.toContext();
        let hash    = context.rootHashes[0] as Hash;

        let missing = await this.findMissingReferencesWithContext(hash, context);

        if (missing.size > 0) {
            Store.operationLog.debug(() => 'Cannot save ' + hash + ' (a ' + object.getClassName() + ') because the following references are missing: ' + Array.from(missing).join(', ') + '.');
            throw new Error('Cannot save object ' + hash + ' (a ' + object.getClassName() + ') because the following references are missing: ' + Array.from(missing).join(', ') + '.');
        }

        Store.operationLog.debug(() => 'Saving object with hash ' + hash + ' .');
        await this.saveWithContext(hash, context);

        // The following is necessary in case the object (or a subobject) was already in the store,
        // and hence saveWithContext didn't visit all subobjects setting hashes and stores.
        for (const [ctxHash, ctxObject] of context.objects.entries()) {
            
            ctxObject.setLastHash(ctxHash);
            
            if (this.resources === undefined) {
                const objResources = ctxObject.getResources()
                if (objResources === undefined || objResources.store !== this) {
                    // refuse to modify a Resources object (that may be in use in other places)
                    // if the object indeed had resources with a different store, discard them and
                    // use a new resources object that just has this store.
                    ctxObject.setResources({ store: this} as any as Resources);
                }
            } else {
                ctxObject.setResources(this.resources);
            }

            if (ctxObject instanceof Identity && !ctxObject.hasKeyPair()) {
                const kp = this.keyPairs.get(ctxObject.getKeyPairHash());

                if (kp !== undefined) {
                    ctxObject.addKeyPair(kp);
                }
            }
        }

        if (saveMutations) {

            if (object instanceof MutableObject) {
                let queuedOps = await object.saveQueuedOps(); // see (* note 1) above
                if (queuedOps) {
                    Store.operationLog.debug(() => 'Saved queued ops for object with hash ' + hash + ' .');
                }
            }

            const literal = context.literals.get(hash);

            if (literal !== undefined) {
                for (let dependency of literal.dependencies) {
                    if (dependency.type === 'literal') {
                        const depObject = context.objects.get(dependency.hash);
                        if (depObject !== undefined && depObject instanceof MutableObject) {
                            let queuedOps = await depObject.saveQueuedOps(); // see (* note 1) above
                            if (queuedOps) {
                                Store.operationLog.debug('Saved queued ops for object with hash ' + hash + ' .');
                            }
                        }
                    }
                }    
            }

        }
        
    }

    async findMissingReferencesWithContext(hash: Hash, context: Context, expectedClassName? : string): Promise<Set<Hash>> {

        let literal = context.literals.get(hash);

        if (literal === undefined) {
            return new Set([hash]);
        }

        if (expectedClassName !== undefined && literal.value['_class'] !== expectedClassName) {
            throw new Error('Referenced dependency ' + hash + ' was found in the store with type ' + literal.value['_class'] + ' but was declared as being ' + expectedClassName + '.')
        }

        let missing = new Set<Hash>();

        for (let dependency of literal.dependencies) {

            let depHash = dependency.hash;

            let dep = context.literals.get(depHash);

            if (dep === undefined) {
                let storedDep = await this.load(depHash, false);

                if (storedDep === undefined) {
                    missing.add(depHash);
                } else {
                    if (storedDep.getClassName() !== dependency.className) {
                        throw new Error('Referenced dependency ' + dependency.hash + ' was found in the store with type ' + storedDep.getClassName() + ' but was declared as being ' + dependency.className + ' on path ' + dependency.path + '.');
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

    // low level save: no mutation flush, no hash/store setting in objects
    async saveWithContext(hash: Hash, context: Context, saved=new Set<Hash>()) : Promise<void> {

        if (saved.has(hash)) {
            return;
        }

        const object = context.objects.get(hash);

        if (object === undefined) {
            throw new Error('Object with hash ' + hash + ' is missing from context, cannot save it.');
        }

        if (this.resources === undefined) {
            object.setResources({store: this} as any as Resources)
        } else {
            object.setResources(this.resources);
        }

        //object.setStore(this);

        object.setLastHash(hash);

        const author = object.getAuthor();
        const loadedLit = (await this.backend.load(hash))?.literal;

        if (loadedLit !== undefined) { 

            if (object.shouldSignOnSave() && loadedLit.signature) {
                object.setLastSignature(loadedLit.signature);
            }

        } else {

            if (author !== undefined) {

                if (object.shouldSignOnSave() && !object.hasLastSignature()) {

                    if (!author.hasKeyPair()) {
                        const kp = await this.load(author.getKeyPairHash(), false);
                        if (kp instanceof RSAKeyPair) {
                            author.addKeyPair(kp);
                        }
                    }
    
                    object.setLastSignature(await author.sign(hash));
                    (context.literals.get(hash) as Literal).signature = object.getLastSignature();
                }
    
                if (!object.hasLastSignature()) {
                    throw new Error('Cannot save ' + hash + ', its signature is missing');
                }
    
            }

            const literal = context.literals.get(hash);

            if (literal === undefined) {
                throw new Error('Trying to save ' + hash + ', but its literal is missing from the received context.')
            }

            if (literal !== undefined) {
                for (let dependency of literal.dependencies) {
                    if (dependency.type === 'literal') {
                        await this.saveWithContext(dependency.hash, context, saved);
                    }
                }    
            }

            let history: StoredOpHeader | undefined = undefined;

            if (object instanceof MutationOp) {

                const prevOpHeaders = new Map<Hash, OpHeader>();

                if (object.prevOps !== undefined) {
                    for (const hashRef of object.prevOps.values()) {

                        const prevOpHistory = await this.loadOpHeader(hashRef.hash);
                        
                        if (prevOpHistory === undefined) {
                            throw new Error('Header of prevOp ' + hashRef.hash + ' of op ' + hash + ' is missing from store, cannot save');
                        }

                        prevOpHeaders.set(hashRef.hash, prevOpHistory);
                    }
                }

                const opHistory = new OpHeader(object, prevOpHeaders);

                history = {
                    literal: opHistory.literalize()
                };
            }

            if (object.getClassName() === RSAKeyPair.className) {
                this.keyPairs.set(object.getLastHash(), object as RSAKeyPair);
            }

            await this.backend.store(literal, history);
            saved.add(hash);

            if (object instanceof MutationOp) {

                if (object.causalOps !== undefined) {

                    // If any of the causal ops has been invalidated, check if we should cascade
                    
                    //console.log('checking invalidations for ' + object.hash())
                    for (const causalOp of object.causalOps.values()) {
                        //console.log('found causal op ' + causalOp.hash())
                        const invalidations = await this.loadAllInvalidations(causalOp.getLastHash());
                        
                        for (const inv of invalidations) {
                            //console.log('found ' + inv.hash())
                            // Note1: Since the invAfterOp was already saved and this op was not (loaded === undefined above)
                            //        we can be sure that object is outside of invAfterOp.prevOps.
                            // Note2: invAfterOp only affects causal relationships within the same MutableObject (otherwise 
                            //        prevOps is meaningless).
                            const shouldInv  = inv instanceof InvalidateAfterOp && inv.getTargetObject().equals(object.getTargetObject());
                            const shouldCasc = inv instanceof CascadedInvalidateOp;
                            if (shouldInv || shouldCasc) {
                                //console.log('WILL CASCADE')
                                const casc = CascadedInvalidateOp.create(object, inv);
                                casc.toContext(context);
                                await this.saveWithContext(casc.getLastHash(), context, saved);
                            }  else {
                                //console.log('WILL NOT CASCADE')
                            }
                        }
                    }

                }

            }
            
            if (object instanceof InvalidateAfterOp || object instanceof CascadedInvalidateOp) {

                const consequences = await this.loadAllConsequences(object.getTargetOp().hash());
                
                if (consequences.length > 0) { // if there are no consequences, optimize away the following

                    if (object instanceof InvalidateAfterOp) {

                        const validConsequences = await this.loadPrevOpsClosureFast(object.getTerminalOps(), object.getTargetObject().getLastHash());

                        for (const conseqOp of consequences.values()) {
                            if (!validConsequences.has(conseqOp.getLastHash())) {
                                //console.log('invalidating a ' + conseqOp.getClassName() + ' because of a ' + object.getClassName());
                                if (conseqOp instanceof CascadedInvalidateOp) {
                                    //console.log('final target is a ' + conseqOp.getFinalTargetOp().getClassName());
                                }
                                const casc = CascadedInvalidateOp.create(conseqOp, object);
                                casc.toContext(context);
                                await this.saveWithContext(casc.getLastHash(), context, saved);
                            }
                        }
                    
                    } else if (object instanceof CascadedInvalidateOp) {
        
                        
                        for (const conseqOp of consequences.values()) {
                            //console.log('cascading an invalidation of a ' + object.getFinalTargetOp().getClassName());
                            //console.log('found a dep: ' + conseqOp.getClassName());    
                            const casc = CascadedInvalidateOp.create(conseqOp, object);
                            casc.toContext(context);
                            await this.saveWithContext(casc.getLastHash(), context, saved);
                        }

                    }

                }

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

        let literal = this.cache.get(hash);

        if (literal === undefined) {
            literal = (await this.backend.load(hash))?.literal;
            if (literal !== undefined) {
                this.cache.set(literal?.hash, literal);
            }
        }

        return literal;
    }
    
    async loadRef<T extends HashedObject>(ref: HashReference<T>, loadMutations=true) : Promise<T | undefined> {
        let obj = await this.load(ref.hash, loadMutations);

        if (obj !== undefined && ref.className !== obj.getClassName()) {
            throw new Error('Error loading reference to ' + ref.className + ': object with hash ' + ref.hash + ' has class ' + obj.getClassName() + ' instead.');
        }

        return obj as T | undefined;
    }

    // convenience
    async loadWithoutMutations(hash: Hash): Promise<HashedObject | undefined> {
        return this.load(hash, false);
    }

    // convenience
    async loadAndWatchForChanges(hash: Hash): Promise<HashedObject | undefined> {
        return this.load(hash, true, true);
    }

    // convenience
    async loadInitialValue(hash: Hash): Promise<HashedObject | undefined> {
        return this.load(hash, false, false);
    }

    async load<T=HashedObject>(hash: Hash, loadMutations=true, watchForChanges=false) : Promise<T | undefined> {

        await this.initKeyPairs;

        //console.log('+++ loading ' + hash, new Error().stack)

        if (!loadMutations && watchForChanges) {
            throw Error('Trying to load ' + hash + ' from the store, but loadMutations=false and watchForChanges=true. This combination does not make sense.');
        }

        let context = new Context();

        context.resources = this.resources;

        const object = await this.loadWithContext(hash, context);

        if (loadMutations && object !== undefined) {

            if (watchForChanges) {
                object.watchForChanges();
            }

            //console.log('+++ loading changes for ' + hash + ' ', new Error().stack);
            await object.loadAllChanges(undefined, context);

            /*for (const subobj of context.objects.values()) {
                if (watchForChanges) {
                    subobj.watchForChanges();
                }
    
                await subobj.loadAllChanges();
            }*/
        }

        //console.log('+++ loaded ' + hash, object?.getClassName());

        if (object instanceof MutationOp) {
            //console.log('+++ target: ' + object.getTargetObject().getLastHash() + ' (' + object.getTargetObject().getClassName() + ')');
        } 

        return object as (T|undefined);
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

                if (this.resources === undefined) {
                    ctxObj.setResources({store: this} as any as Resources)
                } else {
                    ctxObj.setResources(this.resources);
                }

                if (ctxObj instanceof Identity) {
                    const id = ctxObj as Identity;
                    if (!id.hasKeyPair()) {
                        let kp = this.keyPairs.get(id.getKeyPairHash());
                        if (kp !== undefined && kp instanceof RSAKeyPair) {
                            id.addKeyPair(kp);
                        }
                    }
                }
                
            }

            
        }

        return obj;
    }

    async loadByClass(className: string, params?: LoadParams, context = new Context()) : Promise<LoadResults> {

        let searchResults = await this.backend.searchByClass(className, params);

        return this.loadSearchResults(searchResults, context);

    }

    async loadByReference(referringPath: string, referencedHash: Hash, params?: LoadParams, context = new Context()) : Promise<LoadResults> {

        let searchResults = await this.backend.searchByReference(referringPath, referencedHash, params);

        return this.loadSearchResults(searchResults, context);
    }

    async loadByReferencingClass(referringClassName: string, referringPath: string, referencedHash: Hash, params?: LoadParams, context = new Context()) : Promise<LoadResults> {

        let searchResults = await this.backend.searchByReferencingClass(referringClassName, referringPath, referencedHash, params);

        return this.loadSearchResults(searchResults, context);
    }

    async loadOpHeader(opHash: Hash): Promise<OpHeader | undefined> {
        const stored = await this.backend.loadOpHeader(opHash);

        if (stored === undefined) {
            return undefined;
        } else {
            return new OpHeader(stored.literal);
        }

    }

    async loadOpHeaderByHeaderHash(headerHash: Hash): Promise<OpHeader | undefined> {
        const stored = await this.backend.loadOpHeaderByHeaderHash(headerHash);

        if (stored === undefined) {
            return undefined;
        } else {
            return new OpHeader(stored.literal);
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

    private async loadSearchResults(searchResults: BackendSearchResults, context = new Context()) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

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

    async loadPrevOpsClosureFast(init: HashedSet<HashReference<MutationOp>>, lowerBoundHash?: Hash): Promise<Set<Hash>> {

        const closure = new Set<Hash>();
        const pending = new Set<Hash>(Array.from(init.values()).map((ref: HashReference<MutationOp>) => ref.hash));
        const discarded = new Set<Hash>();

        const lowerBoundSeq = lowerBoundHash === undefined? undefined :
                                                            (await this.backend.load(lowerBoundHash))?.sequence;

        while (pending.size > 0) {
            let {value} = pending.values().next();
            pending.delete(value);

            if (!closure.has(value)) {
                let storable = await this.backend.load(value) as Storable;

                if (lowerBoundSeq === undefined || storable.sequence >= lowerBoundSeq) {
                    closure.add(value);

                    const prevOps = HashedSet.deliteralize(LiteralUtils.getFields(storable.literal)['prevOps'], new Context()) as HashedSet<HashReference<MutationOp>>;

                    for (const prevOpRef of prevOps.values()) {
                        if (!closure.has(prevOpRef.hash) && !discarded.has(value)) {
                            pending.add(prevOpRef.hash);
                        }
                    }
                } else {
                    discarded.add(value);
                }
            }
        }

        return closure;
    }

    async loadPrevOpsClosure(init: HashedSet<HashReference<MutationOp>>) {
        const initHashes = new Set<Hash>(Array.from(init.values()).map((ref: HashReference<MutationOp>) => ref.hash));

        return this.loadClosure(initHashes, Store.extractPrevOps);
    }

    async loadClosure(init: Set<Hash>, next: (obj: HashedObject) => Set<Hash>) : Promise<Set<Hash>> {

        let closure = new Set<Hash>();
        let pending = new Set<Hash>(init);

        while (pending.size > 0) {
            let {done, value} = pending.values().next(); done;
            pending.delete(value);
            closure.add(value);

            let obj = await this.load(value, false) as HashedObject;
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

    async loadAllOps(targetObject: Hash, batchSize=128) {
        
        const ops = new Array<MutationOp>();

        let results = await this.loadByReference(
                                    'targetObject', 
                                    targetObject, 
                                    {
                                        order: 'asc',
                                        limit: batchSize
                                    });

        while (results.objects.length > 0) {

            for (const obj of results.objects) {
                if (obj instanceof MutationOp) {
                    ops.push(obj);
                }
            }

            results = await this.loadByReference(
                                            'targetObject', 
                                            targetObject, 
                                            {
                                                order: 'asc',
                                                limit: batchSize,
                                                start: results.end
                                            });
        }

        return ops;
    }

    async loadAllInvalidations(targetOp: Hash) {
        
        const invalidations = new Array<InvalidateAfterOp|CascadedInvalidateOp>();

        let batchSize = 50;

        let results = await this.loadByReference(
                                    'targetOp', 
                                    targetOp, 
                                    {
                                        order: 'asc',
                                        limit: batchSize
                                    });

        while (results.objects.length > 0) {

            for (const obj of results.objects) {
                if (obj instanceof InvalidateAfterOp || obj instanceof CascadedInvalidateOp) {
                    invalidations.push(obj);
                }
            }

            results = await this.loadByReference(
                                            'targetOp', 
                                            targetOp, 
                                            {
                                                order: 'asc',
                                                limit: batchSize,
                                                start: results.end
                                            });
        }

        return invalidations;
    }

    async loadAllConsequences(op: Hash) {
        
        const consequences = new Array<MutationOp>();

        let batchSize = 50;

        let results = await this.loadByReference(
                                    'causalOps', 
                                    op, 
                                    {
                                        order: 'asc',
                                        limit: batchSize
                                    });

        while (results.objects.length > 0) {

            for (const obj of results.objects) {
                if (obj instanceof MutationOp) {
                    consequences.push(obj);
                }
            }

            results = await this.loadByReference(
                                            'causalOps', 
                                            op, 
                                            {
                                                order: 'asc',
                                                limit: batchSize,
                                                start: results.end
                                            });
        }

        return consequences;
    }

    close() {
        this.backend.close();
    }
    
}

export { Store, StoredOpHeader, LoadResults };