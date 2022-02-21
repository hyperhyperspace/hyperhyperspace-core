import { Literal } from 'data/model/literals/LiteralUtils';
import { Hash } from 'data/model/hashing/Hashing';
import { StoredOpHeader } from '../store/Store';

type BackendSearchParams = {order?: 'asc'|'desc'|undefined, start?: string, limit?: number};
type BackendSearchResults = {items : Array<Literal>, start?: string, end?: string };

//type MutableObjectInfo = { hash: Hash, nextOpSeqNumber: number, terminalOps: Array<Hash> };

//type StoredLiteral = { literal: Literal, extra: {opHeight?: number, prevOpCount?: number, causalHistoryHash?: Hash}};


interface Backend {

    getBackendName() : string;
    getName() : string;

    store(literal : Literal, history?: StoredOpHeader) : Promise<void>;
    load(hash: Hash) : Promise<Literal | undefined>;

    loadOpHeader(opHash: Hash) : Promise<StoredOpHeader | undefined>;
    loadOpHeaderByHeaderHash(causalHistoryHash: Hash) : Promise<StoredOpHeader | undefined>;

    loadTerminalOpsForMutable(hash: Hash) : Promise<{lastOp: Hash, terminalOps: Array<Hash>} | undefined>;

    searchByClass(className: string, params? : BackendSearchParams) : Promise<BackendSearchResults>;
    searchByReference(referringPath: string, referencedHash: Hash, params? : BackendSearchParams) : Promise<BackendSearchResults>;
    searchByReferencingClass(referringClassName: string, referringPath: string, referencedHash: Hash, params? : BackendSearchParams) : Promise<BackendSearchResults>;

    close(): void;

    setStoredObjectCallback(objectStoreCallback: (literal: Literal) => Promise<void>): void;

    ready(): Promise<void>;

    //processExternalStore(literal: Literal): Promise<void>;
}

export { Backend, BackendSearchParams, BackendSearchResults };