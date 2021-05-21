import { Backend, BackendSearchParams, BackendSearchResults } from './Backend';
import { Literal, Hash, HashReference, HashedSet } from 'data/model';
import { MultiMap } from 'util/multimap';
import { Store, StoredOpCausalHistory } from 'storage/store/Store';
import { LiteralUtils } from 'data/model/Literals';
import { Logger, LogLevel } from 'util/logging';

type MemStorageFormat = {
    literal: Literal,
    timestamp: string,
    sequence: number
}

type MemOpCausalHistoryFormat = StoredOpCausalHistory;

type MemoryRepr = {
    objects: Map<Hash, MemStorageFormat>,
    classIndex: MultiMap<string, Hash>,
    sortedClassIndex: Map<string, Hash[]>,
    referenceIndex: MultiMap<string, Hash>,
    sortedReferenceIndex: Map<string, Hash[]>,
    referencingClassIndex: MultiMap<string, Hash>,
    sortedReferencingClassIndex: Map<string, Hash[]>,
    terminalOps: MultiMap<Hash, Hash>,
    lastOps: Map<Hash, Hash>,
    opCausalHistories: Map<Hash, MemOpCausalHistoryFormat>,
    opCausalHistoriesByHash: Map<Hash, MemOpCausalHistoryFormat>
}

class MemoryBackend implements Backend {

    static log = new Logger(MemoryBackend.name, LogLevel.INFO);

    static instances: Map<string, MemoryBackend> = new Map();

    static backendName = 'memory';

    static registered: MultiMap<string, MemoryBackend> = new MultiMap();

    static register(backend: MemoryBackend) {
        MemoryBackend.registered.add(backend.name, backend);
    }

    static deregister(backend: MemoryBackend) {
        MemoryBackend.registered.delete(backend.name, backend);
    }

    static getRegisteredInstances(name: string): Set<MemoryBackend> {
        return MemoryBackend.registered.get(name);
    }


    name: string;

    repr: MemoryRepr;

    objectStoreCallback?: (literal: Literal) => Promise<void>;

    constructor(name: string) {
        this.name = name;

        const instances = MemoryBackend.getRegisteredInstances(name);

        if (instances.size > 0) {
            this.repr = instances.values().next().value.repr;
        } else {
            this.repr = {
                objects: new Map(),
                classIndex: new MultiMap(),
                sortedClassIndex: new Map(),
                referenceIndex: new MultiMap(),
                sortedReferenceIndex: new Map(),
                referencingClassIndex: new MultiMap(),
                sortedReferencingClassIndex: new Map(),
                terminalOps: new MultiMap(),
                lastOps: new Map(),
                opCausalHistories: new Map(),
                opCausalHistoriesByHash: new Map()
            }
        }

        MemoryBackend.register(this);

    }

    close(): void {
        MemoryBackend.deregister(this);
    }

    setStoredObjectCallback(objectStoreCallback: (literal: Literal) => Promise<void>): void {
        this.objectStoreCallback = objectStoreCallback;
    }

    getBackendName() {
        return MemoryBackend.backendName;
    }

    getName(): string {
        return this.name;
    }

    async store(literal: Literal, history?: StoredOpCausalHistory): Promise<void> {
        
        // store object
        let storable = {} as MemStorageFormat;

        storable.literal   = literal;
        storable.timestamp = new Date().getTime().toString();
        storable.sequence  = this.repr.objects.size;
        
        this.repr.objects.set(literal.hash, storable);

        // update indexes 
        if (!this.repr.classIndex.has(storable.literal.value._class, literal.hash)) {
            this.repr.classIndex.add(storable.literal.value._class, literal.hash);
            let sorted = this.repr.sortedClassIndex.get(storable.literal.value._class);
            if (sorted === undefined) { sorted = []; this.repr.sortedClassIndex.set(storable.literal.value._class, sorted); }
            sorted.push(literal.hash);
        }
        
        
        for (const dep of literal.dependencies) {
            let reference = dep.path + '#' + dep.hash;
            if (!this.repr.referenceIndex.has(reference, literal.hash)) {
                this.repr.referenceIndex.add(reference, literal.hash);
                let sorted = this.repr.sortedReferenceIndex.get(reference);
                if (sorted === undefined) { sorted = []; this.repr.sortedReferenceIndex.set(reference, sorted); }
                sorted.push(literal.hash);
            }
            
            let referencingClass = dep.className + '.' + dep.path + '#' + dep.hash;
            if (!this.repr.referencingClassIndex.has(referencingClass, literal.hash)) {
                this.repr.referencingClassIndex.add(referencingClass, literal.hash);
                let sorted = this.repr.sortedReferencingClassIndex.get(referencingClass);
                if (sorted === undefined) { sorted = []; this.repr.sortedReferencingClassIndex.set(referencingClass, sorted); }
                sorted.push(literal.hash);
            }
            
        }

        // if necessary, update last ops
        const isOp = literal.value['_flags'].indexOf('op') >= 0;

        if (isOp) {

            if (history === undefined) {
                throw new Error('Missing causal history received by backend while trying to store op ' + literal.hash);
            }

            const historyCopy = Object.assign({}, history);
            this.repr.opCausalHistories.set(literal.hash, historyCopy);
            this.repr.opCausalHistoriesByHash.set(history.literal.causalHistoryHash, historyCopy);

            const mutableHash = LiteralUtils.getFields(storable.literal)['target']['_hash'];

            const prevOpHashes = HashedSet.elementsFromLiteral(LiteralUtils.getFields(storable.literal)['prevOps']).map(HashReference.hashFromLiteral);

            for (const prevOpHash of prevOpHashes) {
                this.repr.terminalOps.delete(mutableHash, prevOpHash);
            }

            if (!this.repr.terminalOps.has(mutableHash, literal.hash)) {
                this.repr.terminalOps.add(mutableHash, literal.hash);
                this.repr.lastOps.set(mutableHash, literal.hash);
            }
        }

        for (const backend of MemoryBackend.getRegisteredInstances(this.name)) {
            if (backend.objectStoreCallback !== undefined) {
                await backend.objectStoreCallback(literal);
            }
        }
    }

    async load(hash: string): Promise<Literal | undefined> {
        const loaded = this.repr.objects.get(hash);

        return loaded?.literal;
    }

    async loadTerminalOpsForMutable(hash: string): Promise<{ lastOp: string; terminalOps: string[]; } | undefined> {
        
        const lastOp = this.repr.lastOps.get(hash);
        const terminalOps = this.repr.terminalOps.get(hash);

        if (lastOp !== undefined && terminalOps !== undefined && terminalOps.size > 0) {
            return { lastOp: lastOp, terminalOps: Array.from(terminalOps.values()) };
        } else {
            return undefined;
        }

    }

    searchByClass(className: string, params?: BackendSearchParams | undefined): Promise<BackendSearchResults> {
        return this.searchByIndex(className, this.repr.sortedClassIndex, params);
    }

    searchByReference(referringPath: string, referencedHash: string, params?: BackendSearchParams | undefined): Promise<BackendSearchResults> {
        let key =  referringPath + '#' + referencedHash;
        return this.searchByIndex(key, this.repr.sortedReferenceIndex, params);
    }

    searchByReferencingClass(referringClassName: string, referringPath: string, referencedHash: string, params?: BackendSearchParams | undefined): Promise<BackendSearchResults> {
        let key = referringClassName + '.' + referringPath + '#' + referencedHash;
        return this.searchByIndex(key, this.repr.sortedReferencingClassIndex, params);
    }

    async loadOpCausalHistory(opHash: string): Promise<StoredOpCausalHistory | undefined> {
        return this.repr.opCausalHistories.get(opHash);
    }

    async loadOpCausalHistoryByHash(causalHistoryHash: string): Promise<StoredOpCausalHistory | undefined> {
        return this.repr.opCausalHistoriesByHash.get(causalHistoryHash);
    }

    private async searchByIndex(key: string, sortedIndex: Map<string, Hash[]>, params?: BackendSearchParams | undefined): Promise<BackendSearchResults> {
        
        let classHashes = sortedIndex.get(key);


        if (classHashes === undefined) {
            return { items: [], start: '', end: ''}
        } else {
            let order = (params === undefined || params.order === undefined) ? 'asc' : params.order.toLowerCase();

            let segment;



            if (order === 'desc') {
                classHashes.reverse();
            }
    
            let start = 0;

            if (params !== undefined && params.start !== undefined) {
                start = Number.parseInt(params.start);
            }

            if (start >= classHashes.length) {
                return { items: [], start: classHashes.length.toString(), end: classHashes.length.toString()}
            }

            let end = classHashes.length
            if (params !== undefined && params.limit !== undefined) {
                end = Math.min(start + params.limit, classHashes.length);
            }
            segment = classHashes.slice(start, end);

            let result:Literal[] =  segment.map((hash: Hash) => this.repr.objects.get(hash)?.literal as Literal);
            
            return { start: start.toString(), end: end.toString(), items: result };

        }

    }

    async ready(): Promise<void> {
        
    }
} 

Store.registerBackend(MemoryBackend.backendName, (dbName: string) => {

    let mb = MemoryBackend.instances.get(dbName);

    if (mb === undefined) {
        mb = new MemoryBackend(dbName);
        MemoryBackend.instances.set(dbName, mb);
    }

    return mb;
});

export { MemoryBackend };