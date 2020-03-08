import { Hash } from 'data/model/Hashing';
import { PackedLiteral } from 'data/storage/Store';

type SearchParams = {order?: string, start?: string, limit?: number};
type SearchResults = {items : Array<PackedLiteral>, start?: string, end?: string };

interface Backend {

    store(packed : PackedLiteral) : Promise<void>;
    load(hash: Hash) : Promise<PackedLiteral | undefined>;

    searchByClass(className: string, params? : SearchParams) : Promise<SearchResults>;
    searchByReference(path: string, refHash: Hash, params? : SearchParams) : Promise<SearchResults>;
}

export { Backend, SearchParams, SearchResults }