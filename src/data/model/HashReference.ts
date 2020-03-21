import { Hash } from './Hashing'


class HashReference {
    hash: Hash;
    className: string;

    constructor(hash: Hash, className: string) {
        this.hash = hash;
        this.className = className;
    }
}

export { HashReference }