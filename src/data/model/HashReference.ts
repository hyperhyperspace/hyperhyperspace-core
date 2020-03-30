import { Hash } from './Hashing'
import { HashedObject } from './HashedObject';


class HashReference {
    hash      : Hash;
    className : string;

    constructor(hash: Hash, className: string) {
        this.hash = hash;
        this.className = className;
    }

    static create(target: HashedObject) {
        return new HashReference(target.hash(), target.getClassName());
    }
}

export { HashReference }