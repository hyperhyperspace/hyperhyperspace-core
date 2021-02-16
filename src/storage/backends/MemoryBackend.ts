import { Backend, BackendSearchParams, BackendSearchResults } from './Backend';
import { Literal, Hash } from 'data/model';
import { MultiMap } from 'util/multimap';
import { Store } from 'storage/store/Store';

type MemStorageFormat = {
    literal: Literal,
    timestamp: string,
    sequence: number
}

class MemoryBackend implements Backend {

    static backendName = 'memory';

    name: string;

    objects: Map<Hash, MemStorageFormat>;
    classIndex: MultiMap<string, Hash>;
    sortedClassIndex: Map<string, Hash[]>;
    referenceIndex: MultiMap<string, Hash>;
    sortedReferenceIndex: Map<string, Hash[]>;
    referencingClassIndex: MultiMap<string, Hash>;
    sortedReferencingClassIndex: Map<string, Hash[]>;
    terminalOps: MultiMap<Hash, Hash>;
    lastOps: Map<Hash, Hash>;

    constructor(name: string) {
        this.name = name;

        this.objects = new Map();
        this.classIndex = new MultiMap();
        this.sortedClassIndex = new Map();
        this.referenceIndex = new MultiMap();
        this.sortedReferenceIndex = new Map();
        this.referencingClassIndex = new MultiMap();
        this.sortedReferencingClassIndex = new Map();
        this.terminalOps = new MultiMap();
        this.lastOps = new Map();
    }
    async processExternalStore(literal: Literal): Promise<void> {
        await this.store(literal);
    }

    getBackendName() {
        return MemoryBackend.backendName;
    }

    getName(): string {
        return this.name;
    }

    async store(literal: Literal): Promise<void> {
        
        // store object
        let storable = {} as MemStorageFormat;

        storable.literal   = literal;
        storable.timestamp = new Date().getTime().toString();
        storable.sequence  = this.objects.size;
        
        this.objects.set(literal.hash, storable);

        // update indexes 
        if (!this.classIndex.has(storable.literal.value._class, literal.hash)) {
            this.classIndex.add(storable.literal.value._class, literal.hash);
            let sorted = this.sortedClassIndex.get(storable.literal.value._class);
            if (sorted === undefined) { sorted = []; this.sortedClassIndex.set(storable.literal.value._class, sorted); }
            sorted.push(literal.hash);
        }
        
        
        for (const dep of literal.dependencies) {
            let reference = dep.path + '#' + dep.hash;
            if (!this.referenceIndex.has(reference, literal.hash)) {
                this.referenceIndex.add(reference, literal.hash);
                let sorted = this.sortedReferenceIndex.get(reference);
                if (sorted === undefined) { sorted = []; this.sortedReferenceIndex.set(reference, sorted); }
                sorted.push(literal.hash);
            }
            
            let referencingClass = dep.className + '.' + dep.path + '#' + dep.hash;
            if (!this.referencingClassIndex.has(referencingClass, literal.hash)) {
                this.referencingClassIndex.add(referencingClass, literal.hash);
                let sorted = this.sortedReferencingClassIndex.get(referencingClass);
                if (sorted === undefined) { sorted = []; this.sortedReferencingClassIndex.set(referencingClass, sorted); }
                sorted.push(literal.hash);
            }
            
        }

        // if necessary, update last ops
        const isOp = literal.value['_flags'].indexOf('op') >= 0;

        if (isOp) {
            const mutableHash = storable.literal.value._fields['target']['_hash'];

        
            const prevOpHashes =  storable.literal.value._fields['prevOps']['_elements']
                                    .map((elmtValue: {_hash: Hash}) => elmtValue['_hash']) as Array<Hash>;
            

            for (const prevOpHash of prevOpHashes) {
                this.terminalOps.delete(mutableHash, prevOpHash);
            }

            if (!this.terminalOps.has(mutableHash, literal.hash)) {
                this.terminalOps.add(mutableHash, literal.hash);
                this.lastOps.set(mutableHash, literal.hash);
            }
        }

    }

    async load(hash: string): Promise<Literal | undefined> {
        return this.objects.get(hash)?.literal;
    }

    async loadTerminalOpsForMutable(hash: string): Promise<{ lastOp: string; terminalOps: string[]; } | undefined> {
        
        const lastOp = this.lastOps.get(hash);
        const terminalOps = this.terminalOps.get(hash);

        if (lastOp !== undefined && terminalOps !== undefined && terminalOps.size > 0) {
            return { lastOp: lastOp, terminalOps: Array.from(terminalOps.values()) };
        } else {
            return undefined;
        }

    }

    searchByClass(className: string, params?: BackendSearchParams | undefined): Promise<BackendSearchResults> {
        return this.searchByIndex(className, this.sortedClassIndex, params);
    }

    searchByReference(referringPath: string, referencedHash: string, params?: BackendSearchParams | undefined): Promise<BackendSearchResults> {
        let key =  referringPath + '#' + referencedHash;
        return this.searchByIndex(key, this.sortedReferenceIndex, params);
    }

    searchByReferencingClass(referringClassName: string, referringPath: string, referencedHash: string, params?: BackendSearchParams | undefined): Promise<BackendSearchResults> {
        let key = referringClassName + '.' + referringPath + '#' + referencedHash;
        return this.searchByIndex(key, this.sortedReferencingClassIndex, params);
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

            let result:Literal[] =  segment.map((hash: Hash) => this.objects.get(hash)?.literal as Literal);
            
            return { start: start.toString(), end: end.toString(), items: result };

        }

    }
} 

Store.registerBackend(MemoryBackend.backendName, (dbName: string) => new MemoryBackend(dbName));

export { MemoryBackend };