import { PackedLiteral } from 'data/storage/Store';
import { Hash } from 'data/model/Hashing';

type BackendSearchParams = {order?: string, start?: string, limit?: number};
type BackendSearchResults = {items : Array<PackedLiteral>, start?: string, end?: string };

interface Backend {

    store(packed : PackedLiteral) : Promise<void>;
    load(hash: Hash) : Promise<PackedLiteral | undefined>;

    searchByClass(className: string, params? : BackendSearchParams) : Promise<BackendSearchResults>;
    searchByReference(referringClassName: string, referringPath: string, referencedHash: Hash, params? : BackendSearchParams) : Promise<BackendSearchResults>;
}

export { Backend, BackendSearchParams, BackendSearchResults }