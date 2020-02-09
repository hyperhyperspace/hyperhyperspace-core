import { Hashing, Hash } from './Hashing';
import { HashedObject } from './HashedObject';

class HashedSet<T> {

    static hash(element: any) : Hash {
        return Hashing.forLiteral(HashedObject.literalize(element));
    }

    hashedElements : Map<Hash, T>;

    constructor() {
        this.hashedElements = new Map();
    }

    add(element: T) {
        this.hashedElements.set(HashedSet.hash(element), element);
    }

    remove(element: T) {
        return this.removeByHash(HashedSet.hash(element));
    }

    removeByHash(hash: string) {
        return this.hashedElements.delete(hash);
    }

    has(element: T) {
        return this.hasByHash(HashedSet.hash(element));
    }

    hasByHash(hash: string) {
        return this.hashedElements.has(hash);
    }

    toArrays() : {hashes: string[], elements: T[]} {
        let hashes = Array.from(this.hashedElements.keys());
        hashes.sort();

        let elements = [];

        for (let hash of hashes) {
            elements.push(this.hashedElements.get(hash));
        }

        return {hashes: hashes, elements: elements as T[]};
    }

    fromArrays(hashes: string[], elements: any[]) {
        for (let i=0; i<HashedSet.length; i++) {
            this.hashedElements.set(hashes[i], elements[i]);
        }
    }

    equals(another: HashedSet<T>) {
        let hashes = Array.from(this.hashedElements.keys());
        hashes.sort();
        let anotherHashes = Array.from(another.hashedElements.keys());
        anotherHashes.sort();

        let result = hashes.length === anotherHashes.length;

        for(let i=0; result && i<hashes.length; i++) {
            result = hashes[i] === anotherHashes[i];
        }

        return result;
    }

}

export { HashedSet };