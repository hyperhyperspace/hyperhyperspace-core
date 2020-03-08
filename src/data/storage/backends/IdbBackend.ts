require('indexeddbpoly');

import { Backend, SearchParams, SearchResults } from 'data/storage/Backend'; 
import { PackedLiteral } from 'data/storage/Store';

import { openDB, IDBPDatabase } from 'idb';

type IdbStorageFormat = {
    packed: PackedLiteral,
    indexes: any,
    timestamp: string
}

class IdbBackend implements Backend {

    static readonly OBJ_STORE = 'object_store';

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

    async store(packed: PackedLiteral): Promise<void> {

        let idb = await this.idbPromise;

        let storable = {} as IdbStorageFormat;

        storable.packed = packed;
                
        storable.indexes = {} as any;

        storable.timestamp = new Date().getTime().toString();

        IdbBackend.assignIdxValue(storable, IdbBackend.CLASS_IDX_KEY, storable.packed.value._class);
        IdbBackend.assignIdxValue(storable, IdbBackend.CLASS_TIMESTAMP_IDX_KEY, storable.packed.value._class, {timestamp: true});

        for (let i=0; i<packed.dependencies.length; i++) {
            let reference = packed.value._class + '.' + packed.references[i] + '#' + packed.dependencies[i];
            IdbBackend.assignIdxValue(storable, IdbBackend.REFERENCES_IDX_KEY, reference, {multi: true});
            IdbBackend.assignIdxValue(storable, IdbBackend.REFERENCE_TIMESTAMPS_IDX_KEY, reference, {timestamp: true, multi: true});
        }

        return idb.put(IdbBackend.OBJ_STORE, storable).then((_key : IDBValidKey) => { });

    }
    
    async load(hash: string): Promise<PackedLiteral | undefined> {

        let idb = await this.idbPromise;

        return idb.get(IdbBackend.OBJ_STORE, hash).then((storable: IdbStorageFormat | undefined) => (storable?.packed)) as Promise<PackedLiteral | undefined>;
    }

    async searchByClass(className: string, params?: SearchParams): Promise<SearchResults> {
        return this.searchByIndex(IdbBackend.CLASS_TIMESTAMP_IDX_KEY + '_idx', className, params);
    }

    async searchByReference(path: string, refHash: string, params?: SearchParams): Promise<SearchResults> {
        return this.searchByIndex(IdbBackend.REFERENCE_TIMESTAMPS_IDX_KEY + '_idx', path + '#' + refHash, params);
    }

    private async searchByIndex(index: string, value: string, params?: SearchParams) : Promise<SearchResults> {
        
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

        let searchResults = {} as SearchResults;

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

        return ingestCursor().then(() => searchResults);
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

        }

        storable.indexes[key]
    }

    private static addTimestampToValue(value: string, timestamp: string) {
        return value + '_' + timestamp;
    }
}

export { IdbBackend }