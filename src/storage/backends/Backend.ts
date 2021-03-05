import { Literal } from 'data/model/Literals';
import { Hash } from 'data/model/Hashing';

type BackendSearchParams = {order?: 'asc'|'desc'|undefined, start?: string, limit?: number};
type BackendSearchResults = {items : Array<Literal>, start?: string, end?: string };

//type MutableObjectInfo = { hash: Hash, nextOpSeqNumber: number, terminalOps: Array<Hash> };

type StoredLiteral = { literal: Literal, extra: {opHeight?: number, prevOpCount?: number, causalHistoryHash?: Hash}};

interface Backend {

    getBackendName() : string;
    getName() : string;

    store(literal : Literal) : Promise<void>;
    load(hash: Hash) : Promise<StoredLiteral | undefined>;

    loadTerminalOpsForMutable(hash: Hash) : Promise<{lastOp: Hash, terminalOps: Array<Hash>} | undefined>;

    searchByClass(className: string, params? : BackendSearchParams) : Promise<BackendSearchResults>;
    searchByReference(referringPath: string, referencedHash: Hash, params? : BackendSearchParams) : Promise<BackendSearchResults>;
    searchByReferencingClass(referringClassName: string, referringPath: string, referencedHash: Hash, params? : BackendSearchParams) : Promise<BackendSearchResults>;

    close(): void;

    setStoredObjectCallback(objectStoreCallback: (literal: Literal) => Promise<void>): void;

    //processExternalStore(literal: Literal): Promise<void>;
}

export { Backend, StoredLiteral, BackendSearchParams, BackendSearchResults };