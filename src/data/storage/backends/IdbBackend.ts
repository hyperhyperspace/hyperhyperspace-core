require('indexeddbpoly');

import { Backend, BackendSearchParams, BackendSearchResults } from 'data/storage/Backend'; 
import { PackedLiteral } from 'data/storage/Store';
import { Hash } from 'data/model/Hashing';

import { openDB, IDBPDatabase } from 'idb';

type IdbStorageFormat = {
    packed: PackedLiteral,
    indexes: any,
    timestamp: string
}

type IdbTerminalOpsFormat = {
    mutableHash: Hash,
    terminalOpHashes: Array<Hash>
}

class IdbBackend implements Backend {

    static readonly OBJ_STORE = 'object_store';
    static readonly TERMINAL_OPS_STORE = 'terminal_ops_store';

    static readonly CLASS_IDX_KEY = 'class';
    static readonly CLASS_TIMESTAMP_IDX_KEY = 'class_timestamp';

    static readonly REFERENCES_IDX_KEY = 'references';
    static readonly REFERENCE_TIMESTAMPS_IDX_KEY = 'reference_timestamps';


    name: string;
    idbPromise: Promise<IDBPDatabase>;

    constructor(name: string) {
        this.name = name;

        this.idbPromise = openDB(name, 1, {
            upgrade(db, _oldVersion, _newVersion, _transaction) {
                var objectStore = db.createObjectStore(IdbBackend.OBJ_STORE, {keyPath: 'packed.hash'});

                objectStore.createIndex(IdbBackend.CLASS_IDX_KEY + '_idx', 'indexes.' + IdbBackend.CLASS_IDX_KEY);
                objectStore.createIndex(IdbBackend.CLASS_TIMESTAMP_IDX_KEY + '_idx', 'indexes.' + IdbBackend.CLASS_TIMESTAMP_IDX_KEY);

                objectStore.createIndex(IdbBackend.REFERENCES_IDX_KEY + '_idx', 'indexes.' + IdbBackend.REFERENCES_IDX_KEY, {multiEntry: true});
                objectStore.createIndex(IdbBackend.REFERENCE_TIMESTAMPS_IDX_KEY + '_idx', 'indexes.' + IdbBackend.REFERENCE_TIMESTAMPS_IDX_KEY, {multiEntry: true});
            
                db.createObjectStore(IdbBackend.TERMINAL_OPS_STORE, {keyPath: 'mutableHash'});
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

    async store(packed: PackedLiteral, prevOps?: Array<Hash>): Promise<void> {

        let idb = await this.idbPromise;

        let storable = {} as IdbStorageFormat;

        storable.packed = packed;
                
        storable.indexes = {} as any;

        storable.timestamp = new Date().getTime().toString();

        IdbBackend.assignIdxValue(storable, IdbBackend.CLASS_IDX_KEY, storable.packed.value._class);
        IdbBackend.assignIdxValue(storable, IdbBackend.CLASS_TIMESTAMP_IDX_KEY, storable.packed.value._class, {timestamp: true});

        for (let i=0; i<packed.dependencies.length; i++) {
            let reference = packed.dependencies[i].className + '.' + packed.dependencies[i].path + '#' + packed.dependencies[i].hash;
            IdbBackend.assignIdxValue(storable, IdbBackend.REFERENCES_IDX_KEY, reference, {multi: true});
            IdbBackend.assignIdxValue(storable, IdbBackend.REFERENCE_TIMESTAMPS_IDX_KEY, reference, {timestamp: true, multi: true});
        }

        
        //console.log('about to store:');
        //console.log(storable);

        if (prevOps === undefined) {
            return idb.put(IdbBackend.OBJ_STORE, storable).then((_key : IDBValidKey) => { });
        } else {
            let tx = idb.transaction([IdbBackend.OBJ_STORE, IdbBackend.TERMINAL_OPS_STORE]);


            return tx.objectStore(IdbBackend.TERMINAL_OPS_STORE).get(storable.packed.hash)
                     .then(async (terminalOps : (IdbTerminalOpsFormat | undefined)) => {

                if (terminalOps === undefined) {
                    terminalOps = { mutableHash: storable.packed.hash, terminalOpHashes: []};
                }
                for (const hash of prevOps) {
                    let idx = terminalOps.terminalOpHashes.indexOf(hash);
                    if (idx >= 0) {
                        delete terminalOps.terminalOpHashes[idx];
                    }
                }
                if (terminalOps.terminalOpHashes.indexOf(storable.packed.hash) < 0) {
                    terminalOps.terminalOpHashes.push(storable.packed.hash);
                }

                await tx.objectStore(IdbBackend.TERMINAL_OPS_STORE).put(terminalOps);
                await tx.objectStore(IdbBackend.OBJ_STORE).put(storable);

                return;
            });





        }

        

    }
    
    async load(hash: Hash): Promise<PackedLiteral | undefined> {

        let idb = await this.idbPromise;

        return idb.get(IdbBackend.OBJ_STORE, hash)
                  .then((storable: IdbStorageFormat | undefined) => 
                     (storable?.packed)) as Promise<PackedLiteral | undefined>;
    }

    async loadTerminalOps(hash: Hash) : Promise<Array<Hash>> {
        let idb = await this.idbPromise;

        return idb.get(IdbBackend.TERMINAL_OPS_STORE, hash)
                  .then((terminalOps: IdbTerminalOpsFormat | undefined) =>
                      (terminalOps === undefined? [] : terminalOps.terminalOpHashes));
    }

    async searchByClass(className: string, params?: BackendSearchParams): Promise<BackendSearchResults> {
        return this.searchByIndex(IdbBackend.CLASS_TIMESTAMP_IDX_KEY + '_idx', className, params);
    }

    async searchByReference(referringClassName: string, referringPath: string, referencedHash: Hash, params?: BackendSearchParams): Promise<BackendSearchResults> {
        return this.searchByIndex(IdbBackend.REFERENCE_TIMESTAMPS_IDX_KEY + '_idx', 
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
        const direction = order === 'asc' ? 'next' : 'prev';

        let searchResults = {} as BackendSearchResults;

        searchResults.items = [] as Array<PackedLiteral>;
        searchResults.start = undefined;
        searchResults.end   = undefined;

        let ingestCursor = async () => {
      
            var cursor = await idb.transaction([IdbBackend.OBJ_STORE], 'readonly').objectStore(IdbBackend.OBJ_STORE).index(index).openCursor(range, direction);
      
            const limit = params?.limit;

            while ((limit === undefined || searchResults.items.length < limit) && cursor) {
                
                let storable = cursor.value as IdbStorageFormat;
                
                searchResults.items.push(storable.packed);
                if (searchResults.start === undefined) {
                    searchResults.start = cursor.key.toString();
                }
                searchResults.end = cursor.key.toString();
                
                cursor = await cursor.continue();
            }
        }

        await ingestCursor();
        
        return searchResults;
    }

    private static assignIdxValue(storable: IdbStorageFormat, key: string, value: string, params?:{timestamp?: boolean, multi?: boolean}) {
        if (params !== undefined && params.timestamp !== undefined && params.timestamp) {
            value = IdbBackend.addTimestampToValue(value, storable.timestamp);
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

    private static addTimestampToValue(value: string, timestamp: string) {
        return value + '_' + timestamp;
    }
}

export { IdbBackend }