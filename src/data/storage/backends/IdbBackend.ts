require('indexeddbpoly');

import { Backend, BackendSearchParams, BackendSearchResults } from 'data/storage/Backend'; 
import { Literal } from 'data/model';
import { Hash } from 'data/model/Hashing';

import { openDB, IDBPDatabase } from 'idb';

type IdbStorageFormat = {
    literal    : Literal,
    indexes   : any,
    timestamp : string,
    sequence  : number
}

type IdbTerminalOpsFormat = {
    mutableHash : Hash,
    terminalOps : Array<Hash>
    lastOp      : Hash;
};

class IdbBackend implements Backend {

    static readonly META_STORE = 'meta_store';
    static readonly OBJ_STORE  = 'object_store';
    static readonly TERMINAL_OPS_STORE = 'terminal_ops_store';

    static readonly CLASS_SEQUENCE_IDX_KEY = 'class_sequence';

    static readonly REFERENCES_SEQUENCE_IDX_KEY = 'references_sequence';

    static readonly REFERENCING_CLASS_SEQUENCE_IDX_KEY = 'referencing_class_sequence';

    name: string;
    idbPromise: Promise<IDBPDatabase>;

    constructor(name: string) {
        this.name = name;

        this.idbPromise = openDB(name, 1, {
            upgrade(db, _oldVersion, _newVersion, _transaction) {

                let objectStore = db.createObjectStore(IdbBackend.OBJ_STORE, {keyPath: 'literal.hash'});

                objectStore.createIndex(IdbBackend.CLASS_SEQUENCE_IDX_KEY + '_idx', 'indexes.' + IdbBackend.CLASS_SEQUENCE_IDX_KEY);
                objectStore.createIndex(IdbBackend.REFERENCES_SEQUENCE_IDX_KEY + '_idx', 'indexes.' + IdbBackend.REFERENCES_SEQUENCE_IDX_KEY, {multiEntry: true});
                objectStore.createIndex(IdbBackend.REFERENCING_CLASS_SEQUENCE_IDX_KEY + '_idx', 'indexes.' + IdbBackend.REFERENCING_CLASS_SEQUENCE_IDX_KEY, {multiEntry: true});

                db.createObjectStore(IdbBackend.TERMINAL_OPS_STORE, {keyPath: 'mutableHash'});
                db.createObjectStore(IdbBackend.META_STORE, { keyPath: 'name'});
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
    }

    getName() {
        return this.name;
    }

    async store(literal: Literal): Promise<void> {

        let idb = await this.idbPromise;

        let storable = {} as IdbStorageFormat;

        storable.literal = literal;
                
        storable.indexes = {} as any;

        storable.timestamp = new Date().getTime().toString();

        let stores = [IdbBackend.OBJ_STORE, IdbBackend.META_STORE];

        const isOp = literal.value['_flags'].indexOf('op') >= 0;

        if (isOp) { stores.push(IdbBackend.TERMINAL_OPS_STORE); }

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
            
            let terminalOpsInfo = (await tx.objectStore(IdbBackend.TERMINAL_OPS_STORE)
                                          .get(storable.literal.value._fields['target']['_hash'])) as IdbTerminalOpsFormat | undefined;

            if (terminalOpsInfo === undefined) {
                terminalOpsInfo = { 
                    mutableHash: storable.literal.value._fields['target']['_hash'], 
                    terminalOps: [storable.literal.hash],
                    lastOp: storable.literal.hash
                 };
            } else {
                for (const hash of storable.literal.value._fields['prevOps']['_hashes'] as Array<Hash>) {
                    let idx = terminalOpsInfo.terminalOps.indexOf(hash);
                    if (idx >= 0) {
                        delete terminalOpsInfo.terminalOps[idx];
                    }
                }
                if (terminalOpsInfo.terminalOps.indexOf(storable.literal.hash) < 0) { // this should always be true
                    terminalOpsInfo.terminalOps.push(storable.literal.hash);
                }
                terminalOpsInfo.lastOp = storable.literal.hash;
            }

            await tx.objectStore(IdbBackend.TERMINAL_OPS_STORE).put(terminalOpsInfo);
        }

        await tx.objectStore(IdbBackend.META_STORE).put(seqInfo);
        await tx.objectStore(IdbBackend.OBJ_STORE).put(storable); 

    }
        
    
    
    async load(hash: Hash): Promise<Literal | undefined> {

        let idb = await this.idbPromise;

        return idb.get(IdbBackend.OBJ_STORE, hash)
                  .then((storable: IdbStorageFormat | undefined) => 
                     (storable?.literal)) as Promise<Literal | undefined>;
    }

    async loadTerminalOpsForMutable(hash: Hash) : Promise<{lastOp: Hash, terminalOps: Array<Hash>} | undefined> {
        let idb = await this.idbPromise;

        return idb.get(IdbBackend.TERMINAL_OPS_STORE, hash);
    }

    async searchByClass(className: string, params?: BackendSearchParams): Promise<BackendSearchResults> {
        return this.searchByIndex(IdbBackend.CLASS_SEQUENCE_IDX_KEY + '_idx', className, params);
    }

    async searchByReference(referringPath: string, referencedHash: Hash, params?: BackendSearchParams): Promise<BackendSearchResults> {
        return this.searchByIndex(IdbBackend.REFERENCES_SEQUENCE_IDX_KEY + '_idx', 
                                  referringPath + '#' + referencedHash, params);
    }

    async searchByReferencingClass(referringClassName: string, referringPath: string, referencedHash: Hash, params?: BackendSearchParams): Promise<BackendSearchResults> {
        return this.searchByIndex(IdbBackend.REFERENCING_CLASS_SEQUENCE_IDX_KEY + '_idx', 
                                  referringClassName + '.' + referringPath + '#' + referencedHash, params);
    }

    private async searchByIndex(index: string, value: string, params?: BackendSearchParams) : Promise<BackendSearchResults> {
        
        let idb = await this.idbPromise;

        let order = (params === undefined || params.order === undefined) ? 'asc' : params.order.toLowerCase();
        let range_start = null;
        let range_end   = null;

        if (order === 'asc') {
            if (params === undefined || params.start === undefined) {
              range_start = value + '_';
            } else {
              range_start = params.start;
            }
            range_end = value + '_Z';
        } else {
            if (params === undefined || params.start === undefined) {
              range_start = value + '_Z';
            } else {
              range_start = params.start;
            }
            range_end = value + '_';
        }

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
}

export { IdbBackend }