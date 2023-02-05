import { Literal } from 'data/model/literals/LiteralUtils';
import { Hash } from 'data/model/hashing/Hashing';
import { StoredOpHeader } from '../store/Store';
import { StateCheckpoint } from 'data/model';

// "start" below refers to an index entry, as returned by "start" and "end" in BackendSearchResults
// if you want results to start on an specific object use startOn, and the index entry will be computed automatically
type BackendSearchParams = {order?: 'asc'|'desc'|undefined, start?: string, startOn?: Hash, limit?: number};
type BackendSearchResults = {items : Array<Literal>, start?: string, end?: string };

// The sequence number in a storable indicates the order in which objects have been persisted.
// It's useful, for example, as a rough approximation of the partial order defined by prevOps,
// since a < b in the prevOps partial order, then seq(a) < seq(b).
type Storable = { literal: Literal, sequence: number };

//type MutableObjectInfo = { hash: Hash, nextOpSeqNumber: number, terminalOps: Array<Hash> };

//type StoredLiteral = { literal: Literal, extra: {opHeight?: number, prevOpCount?: number, causalHistoryHash?: Hash}};


interface Backend {

    getBackendName() : string;
    getName() : string;

    store(literal : Literal, history?: StoredOpHeader) : Promise<void>;
    load(hash: Hash) : Promise<Storable | undefined>;

    storeCheckpoint(checkpoint: StateCheckpoint): Promise<void>;
    loadLastCheckpoint(mutableObject: Hash): Promise<StateCheckpoint|undefined>;

    loadOpHeader(opHash: Hash) : Promise<StoredOpHeader | undefined>;
    loadOpHeaderByHeaderHash(causalHistoryHash: Hash) : Promise<StoredOpHeader | undefined>;

    loadTerminalOpsForMutable(hash: Hash) : Promise<{lastOp: Hash, terminalOps: Array<Hash>} | undefined>;

    // The BackendSearchResults struct returned by the following three contains two strings, start & end, that can be used to
    // fetch more search results, for example by using the "end" string in params.start in another call to the search function.
    // You can think of them as index values for the cursor that search is using. They can be saved and re-used later.

    // The common usage is then call searchBy___(...) first, using an arbitary size limit, and then repeatedly use the result.end
    // to make more calls like searcgBy___(... {start: result.end}) to get all the results in fixed-sized batches.

    // These index values are always strings and can be compared lexicographically.

    // Update Feb 2023: if you want to resume a sequence of calls to searchBy___ on a specific object, instead of using "start"
    // you can use "startOn", that receives the hash of the object you'd like to start from.

    searchByClass(className: string, params? : BackendSearchParams) : Promise<BackendSearchResults>;
    searchByReference(referringPath: string, referencedHash: Hash, params? : BackendSearchParams) : Promise<BackendSearchResults>;
    searchByReferencingClass(referringClassName: string, referringPath: string, referencedHash: Hash, params? : BackendSearchParams) : Promise<BackendSearchResults>;

    close(): void;

    setStoredObjectCallback(objectStoreCallback: (literal: Literal) => Promise<void>): void;

    ready(): Promise<void>;

    //processExternalStore(literal: Literal): Promise<void>;
}

export { Backend, BackendSearchParams, BackendSearchResults };
export type { Storable };