
import { openDB, IDBPDatabase } from 'idb';

import { Logger, LogLevel } from 'util/logging';

import { Literal, Hash, HashedSet, HashReference, StateCheckpoint } from 'data/model';

import { Backend, BackendSearchParams, BackendSearchResults, Storable } from './Backend'; 
import { Store, StoredOpHeader } from 'storage/store/Store';
import { MultiMap } from 'util/multimap';
import { LiteralUtils } from 'data/model/literals/LiteralUtils';

type IdbStorageFormat = {
    literal   : Literal,
    indexes   : any,
    timestamp : string,
    sequence  : number,
}

type IdbTerminalOpsFormat = {
    mutableHash : Hash,
    terminalOps : Array<Hash>
    lastOp      : Hash;
};

class IdbBackend implements Backend {

    static log = new Logger(IdbBackend.name, LogLevel.INFO);
    static terminalOpsStorageLog = new Logger(IdbBackend.name, LogLevel.INFO);
    static backendName = 'idb';

    static registered: MultiMap<string, IdbBackend> = new MultiMap();

    static register(backend: IdbBackend) {
        IdbBackend.registered.add(backend.name, backend);
    }

    static deregister(backend: IdbBackend) {
        IdbBackend.registered.delete(backend.name, backend);
    }

    static getRegisteredInstances(name: string): Set<IdbBackend> {
        return IdbBackend.registered.get(name);
    }

    static async fireCallbacks(dbName: string, literal: Literal) {
        for (const backend of IdbBackend.getRegisteredInstances(dbName)) {
            if (backend.objectStoreCallback !== undefined) {
                await backend.objectStoreCallback(literal);
            }
        }
    }


    static readonly META_STORE = 'meta_store';
    static readonly OBJ_STORE  = 'object_store';
    static readonly CHECKPOINT_STORE  = 'checkpoint_store';
    static readonly TERMINAL_OPS_STORE = 'terminal_ops_store';
    static readonly OP_HEADERS_STORE = 'op_headers_store';

    static readonly CLASS_SEQUENCE_IDX_KEY = 'class_sequence';
    static readonly REFERENCES_SEQUENCE_IDX_KEY = 'references_sequence';
    static readonly REFERENCING_CLASS_SEQUENCE_IDX_KEY = 'referencing_class_sequence';

    static readonly OP_HEADER_HASH_IDX_KEY = 'op_header_hash';

    name: string;
    idbPromise: Promise<IDBPDatabase>;
    closed: boolean;

    objectStoreCallback?: (literal: Literal) => Promise<void>

    constructor(name: string) {
        this.name = name;
        this.closed = false;

        this.idbPromise = openDB(name, 1, {
            upgrade(db, _oldVersion, _newVersion, _transaction) {

                let objectStore = db.createObjectStore(IdbBackend.OBJ_STORE, {keyPath: 'literal.hash'});

                objectStore.createIndex(IdbBackend.CLASS_SEQUENCE_IDX_KEY + '_idx', 'indexes.' + IdbBackend.CLASS_SEQUENCE_IDX_KEY);
                objectStore.createIndex(IdbBackend.REFERENCES_SEQUENCE_IDX_KEY + '_idx', 'indexes.' + IdbBackend.REFERENCES_SEQUENCE_IDX_KEY, {multiEntry: true});
                objectStore.createIndex(IdbBackend.REFERENCING_CLASS_SEQUENCE_IDX_KEY + '_idx', 'indexes.' + IdbBackend.REFERENCING_CLASS_SEQUENCE_IDX_KEY, {multiEntry: true});

                db.createObjectStore(IdbBackend.TERMINAL_OPS_STORE, {keyPath: 'mutableHash'});
                let opHeadersStore = db.createObjectStore(IdbBackend.OP_HEADERS_STORE, {keyPath: 'literal.opHash'});
                opHeadersStore.createIndex(IdbBackend.OP_HEADER_HASH_IDX_KEY + '_idx', 'literal.headerHash' );
                db.createObjectStore(IdbBackend.META_STORE, { keyPath: 'name'});
                db.createObjectStore(IdbBackend.CHECKPOINT_STORE, { keyPath: 'mutableObject'});
            },
            blocked() {
              // …
            },
            blocking() {
              // …
            },
            terminated() {
              // …
            }
        });

        IdbBackend.register(this);

    }

    async processExternalStore(literal: Literal): Promise<void> {
        literal;
    }

    getBackendName() {
        return IdbBackend.backendName;
    }

    getName() {
        return this.name;
    }

    async store(literal: Literal, opHeader?: StoredOpHeader): Promise<void> {

        if (this.closed) {
            throw new Error('Attempted to store a literal on a closed IndexedDB backend.')
        }

        let idb = await this.idbPromise;

        let storable = {} as IdbStorageFormat;

        storable.literal = literal;
                
        storable.indexes = {} as any;

        storable.timestamp = new Date().getTime().toString();

        let stores = [IdbBackend.OBJ_STORE, IdbBackend.META_STORE];

        const isOp = literal.value['_flags'].indexOf('op') >= 0;

        if (isOp) {
            stores.push(IdbBackend.TERMINAL_OPS_STORE);
            stores.push(IdbBackend.OP_HEADERS_STORE);
        }

        let tx = idb.transaction(stores, 'readwrite');

        let seqInfo = await tx.objectStore(IdbBackend.META_STORE).get('current_object_sequence');
        if (seqInfo === undefined) {
            seqInfo = { name: 'current_object_sequence', value: 0 };
        }

        storable.sequence = seqInfo.value;
        seqInfo.value = seqInfo.value + 1;

        IdbBackend.assignIdxValue(storable, IdbBackend.CLASS_SEQUENCE_IDX_KEY, storable.literal.value._class, {sequence: true});

        for (const dep of literal.dependencies) {
            let reference = dep.path + '#' + dep.hash;
            IdbBackend.assignIdxValue(storable, IdbBackend.REFERENCES_SEQUENCE_IDX_KEY, reference, {sequence: true, multi: true});
            let referencingClass = dep.className + '.' + dep.path + '#' + dep.hash;
            IdbBackend.assignIdxValue(storable, IdbBackend.REFERENCING_CLASS_SEQUENCE_IDX_KEY, referencingClass, {sequence: true, multi: true});
        }

        if (isOp) {

            if (opHeader === undefined) {
                throw new Error('Missing causal history received by backend while trying to store op ' + literal.hash);
            }

            await tx.objectStore(IdbBackend.OP_HEADERS_STORE).put(opHeader);
            
            const mutableHash = LiteralUtils.getFields(storable.literal)['targetObject']['_hash'];

            const prevOpHashes = HashedSet.elementsFromLiteral(LiteralUtils.getFields(storable.literal)['prevOps']).map(HashReference.hashFromLiteral);

            IdbBackend.terminalOpsStorageLog.debug('updating stored last ops for ' + mutableHash + 
                                                   ' on arrival of ' + storable.literal.hash + 
                                                   ' with prevOps ' + prevOpHashes);
            
            let terminalOpsInfo = (await tx.objectStore(IdbBackend.TERMINAL_OPS_STORE)
                                           .get(mutableHash)) as IdbTerminalOpsFormat | undefined;

            if (terminalOpsInfo === undefined) {
                IdbBackend.terminalOpsStorageLog.trace('found no stored last ops, setting last ops to [' + storable.literal.hash + ']');
                terminalOpsInfo = { 
                    mutableHash: mutableHash, 
                    terminalOps: [storable.literal.hash],
                    lastOp: storable.literal.hash
                 };
            } else {
                IdbBackend.terminalOpsStorageLog.trace('stored last ops are: ' + terminalOpsInfo.terminalOps);
                
                IdbBackend.terminalOpsStorageLog.trace('removing new op last ops which are ' + prevOpHashes);
                for (const hash of prevOpHashes) {
                    let idx = terminalOpsInfo.terminalOps.indexOf(hash);
                    if (idx >= 0) {
                        terminalOpsInfo.terminalOps.splice(idx, 1);
                    }
                }

                if (terminalOpsInfo.terminalOps.indexOf(storable.literal.hash) < 0) { // this should always be true
                    terminalOpsInfo.terminalOps.push(storable.literal.hash);
                }
                
                IdbBackend.terminalOpsStorageLog.debug('final last ops after added new op if necessary:' + terminalOpsInfo.terminalOps);
                terminalOpsInfo.lastOp = storable.literal.hash;
            }

            await tx.objectStore(IdbBackend.TERMINAL_OPS_STORE).put(terminalOpsInfo);
        }

        await tx.objectStore(IdbBackend.META_STORE).put(seqInfo);
        await tx.objectStore(IdbBackend.OBJ_STORE).put(storable);

        await tx.done;
        
        await IdbBackend.fireCallbacks(this.name, literal);
    }
    
    async load(hash: Hash): Promise<Storable | undefined> {

        if (this.closed) {
            throw new Error('Attempted to load a literal from a closed IndexedDB backend.')
        }

        let idb = await this.idbPromise;

        const loaded = await (idb.get(IdbBackend.OBJ_STORE, hash) as Promise<IdbStorageFormat|undefined>);

        if (loaded === undefined) {
            return undefined;
        } else {
            return { literal: loaded.literal, sequence: loaded.sequence };
        }
    }

    async loadTerminalOpsForMutable(hash: Hash) : Promise<{lastOp: Hash, terminalOps: Array<Hash>} | undefined> {
        let idb = await this.idbPromise;

        return idb.get(IdbBackend.TERMINAL_OPS_STORE, hash);
    }

    async searchByClass(className: string, params?: BackendSearchParams): Promise<BackendSearchResults> {

        const indexValue = className;

        await this.computeStartOnIndexValue(indexValue, params);

        return this.searchByIndex(IdbBackend.CLASS_SEQUENCE_IDX_KEY + '_idx', indexValue, params);
    }

    async searchByReference(referringPath: string, referencedHash: Hash, params?: BackendSearchParams): Promise<BackendSearchResults> {
        
        const indexValue = referringPath + '#' + referencedHash;

        await this.computeStartOnIndexValue(indexValue, params);
        
        return this.searchByIndex(IdbBackend.REFERENCES_SEQUENCE_IDX_KEY + '_idx', 
                                  indexValue, params);
    }

    async searchByReferencingClass(referringClassName: string, referringPath: string, referencedHash: Hash, params?: BackendSearchParams): Promise<BackendSearchResults> {
        
        const indexValue = referringClassName + '.' + referringPath + '#' + referencedHash;

        await this.computeStartOnIndexValue(indexValue, params);
        
        return this.searchByIndex(IdbBackend.REFERENCING_CLASS_SEQUENCE_IDX_KEY + '_idx', 
                                  indexValue, params);
    }

    private async computeStartOnIndexValue(indexValue: string, params?: BackendSearchParams): Promise<void> {
        if (params?.startOn !== undefined) {
            const storable = await this.load(params.startOn);
            if (storable !== undefined) {
                params.start =  IdbBackend.addSequenceToValue(indexValue, storable.sequence);
            }
        }
    }

    async loadOpHeader(opHash: string): Promise<StoredOpHeader | undefined> {

        if (this.closed) {
            throw new Error('Attempted to load an op header from a closed IndexedDB backend.')
        }

        let idb = await this.idbPromise;
        return await (idb.get(IdbBackend.OP_HEADERS_STORE, opHash) as Promise<StoredOpHeader|undefined>);
    }

    async loadOpHeaderByHeaderHash(headerHash: Hash) : Promise<StoredOpHeader | undefined> {


        if (this.closed) {
            throw new Error('Attempted to load an op header by hash from a closed IndexedDB backend.')
        }

        let idb = await this.idbPromise;

        const stored = await idb.transaction([IdbBackend.OP_HEADERS_STORE], 'readonly').objectStore(IdbBackend.OP_HEADERS_STORE).index(IdbBackend.OP_HEADER_HASH_IDX_KEY + '_idx').get(headerHash);

        if (stored) {
            return stored;
        } else {
            return undefined;
        }
    }


    setStoredObjectCallback(objectStoreCallback: (literal: Literal) => Promise<void>): void {
        this.objectStoreCallback = objectStoreCallback;
    }

    close() {
        //IdbBackend.deregister(this);
        this.closed = true;
        return this.idbPromise.then((idb: IDBPDatabase) => { idb.close(); IdbBackend.deregister(this);});
    }

    private async searchByIndex(index: string, value: string, params?: BackendSearchParams) : Promise<BackendSearchResults> {
        
        if (this.closed) {
            throw new Error('Attempted to load literals from a closed IndexedDB backend.')
        }

        let idb = await this.idbPromise;

        let order = (params === undefined || params.order === undefined) ? 'asc' : params.order.toLowerCase();
        let range_start = null;
        let range_end   = null;

        if (params === undefined || params.start === undefined) {
            range_start = value + '_';
        } else {
            range_start = params.start;
        }
        range_end = value + '_Z';

        const range = IDBKeyRange.bound(range_start, range_end, true, true);
        const direction = order === 'desc' ? 'prev' : 'next';

        let searchResults = {} as BackendSearchResults;

        searchResults.items = [] as Array<Literal>;
        searchResults.start = undefined;
        searchResults.end   = undefined;

        //let ingestCursor = async () => {
      
            var cursor = await idb.transaction([IdbBackend.OBJ_STORE], 'readonly').objectStore(IdbBackend.OBJ_STORE).index(index).openCursor(range, direction);
      
            const limit = params?.limit;

            while ((limit === undefined || searchResults.items.length < limit) && cursor) {
                
                let storable = cursor.value as IdbStorageFormat;
                
                searchResults.items.push(storable.literal);
                if (searchResults.start === undefined) {
                    searchResults.start = cursor.key.toString();
                }
                searchResults.end = cursor.key.toString();
                
                cursor = await cursor.continue();
            }
        //}

        //await ingestCursor();
        
        return searchResults;
    }

    private static assignIdxValue(storable: IdbStorageFormat, key: string, value: string, params?:{sequence?: boolean, multi?: boolean}) {
        if (params !== undefined && params.sequence !== undefined && params.sequence) {
            value = IdbBackend.addSequenceToValue(value, storable.sequence);
        }

        if (params !== undefined && params.multi !== undefined && params.multi) {
            let values = storable.indexes[key];
            if (values === undefined) {
                values = [];
                storable.indexes[key] = values;
            }
            values.push(value);
        } else {
            storable.indexes[key] = value;
        }
    }

    private static addSequenceToValue(value: string, sequence: number) {
        return value + '_' + sequence.toString(16).padStart(16, '0');
    }

    async ready(): Promise<void> {
        await this.idbPromise;
    }

    static async exists(name: string): Promise<boolean> {

        if (window.indexedDB.databases === undefined) {

            try {
                const db = await openDB(name, 1);

                const exists = db.objectStoreNames.contains(IdbBackend.OBJ_STORE);

                await db.close();

                if (!exists) {
                    console.log('database doesnt exists (from attampting open): ' + name)
                    window.indexedDB.deleteDatabase(name);
                } else {
                    console.log('database exists (from attempting open): ' + name);
                }
                
                return exists;
            } catch (e: any) {
                console.log("error attempting to open idb to check its existence: " + name, e);
                return false;
            }
        } else {
            for (const dbInfo of (await window.indexedDB.databases())) {
                if (dbInfo.name === name) {
                    console.log('database exists (from databases call): ' + name)
                    return true;
                }
            }

            console.log('database doesnt exist (from databases call): ' + name);
            return false;
        }
    }

    async storeCheckpoint(checkpoint: StateCheckpoint): Promise<void> {
        if (this.closed) {
            throw new Error('Attempted to store a checkpoint on a closed IndexedDB backend.')
        }
        const idb = await this.idbPromise;
        const tx = idb.transaction([IdbBackend.CHECKPOINT_STORE], 'readwrite');
        const store = tx.objectStore(IdbBackend.CHECKPOINT_STORE);
        await store.put(checkpoint);
    }

    async loadLastCheckpoint(mutableObject: Hash): Promise<StateCheckpoint|undefined> {
        if (this.closed) {
            throw new Error('Attempted to load a checkpoint from a closed IndexedDB backend.')
        }
        const idb = await this.idbPromise;
        const tx = idb.transaction([IdbBackend.CHECKPOINT_STORE], 'readonly');
        const store = tx.objectStore(IdbBackend.CHECKPOINT_STORE);
        const checkpoint = await store.get(mutableObject);
        return checkpoint;
    }

    async loadLastCheckpointMeta(mutableObject: Hash): Promise<StateCheckpoint|undefined> {
        if (this.closed) {
            throw new Error('Attempted to load a checkpoint from a closed IndexedDB backend.')
        }
        const idb = await this.idbPromise;
        const tx = idb.transaction([IdbBackend.CHECKPOINT_STORE], 'readonly');
        const store = tx.objectStore(IdbBackend.CHECKPOINT_STORE);
        const checkpoint = await store.get(mutableObject);

        const copy: any = {};

        Object.assign(copy, checkpoint);

        const meta = copy as StateCheckpoint;

        meta.exportedState = undefined;

        return checkpoint;
    }
}

Store.registerBackend(IdbBackend.backendName, (dbName: string) => new IdbBackend(dbName));

export { IdbBackend };