import { PackedLiteral } from 'data/storage/Store';
import { Hash } from 'data/model/Hashing';

type BackendSearchParams = {order?: 'asc'|'desc'|undefined, start?: string, limit?: number};
type BackendSearchResults = {items : Array<PackedLiteral>, start?: string, end?: string };

//type MutableObjectInfo = { hash: Hash, nextOpSeqNumber: number, terminalOps: Array<Hash> };

interface Backend {

    getName() : string;

    store(packed : PackedLiteral) : Promise<void>;
    load(hash: Hash) : Promise<PackedLiteral | undefined>;

    loadTerminalOpsForMutable(hash: Hash) : Promise<{lastOp: Hash, terminalOps: Array<Hash>} | undefined>;

    searchByClass(className: string, params? : BackendSearchParams) : Promise<BackendSearchResults>;
    searchByReference(referringPath: string, referencedHash: Hash, params? : BackendSearchParams) : Promise<BackendSearchResults>;
    searchByReferencingClass(referringClassName: string, referringPath: string, referencedHash: Hash, params? : BackendSearchParams) : Promise<BackendSearchResults>;
}

export { Backend, BackendSearchParams, BackendSearchResults }