import { Backend } from 'data/storage/Backend'; 
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

        return idb.put(storable.packed.hash, storable).then((_key : IDBValidKey) => { });

    }
    
    async load(hash: string): Promise<PackedLiteral> {

        let idb = await this.idbPromise;

        return idb.get(IdbBackend.OBJ_STORE, hash) as Promise<PackedLiteral>;
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