import { Hash } from 'data/model/Hashing';
import { PackedLiteral } from 'data/storage/Store';


interface Backend {

    store(packed : PackedLiteral) : Promise<void>;
    load(hash: Hash) : Promise<PackedLiteral>;

}

export { Backend }