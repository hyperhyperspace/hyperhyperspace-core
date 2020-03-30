import { Hashing, Hash } from './Hashing';
import { HashedObject } from './HashedObject';

class HashedSet<T> {

    static hash(element: any) : Hash {

        let hash: Hash;

        if (element instanceof HashedObject) {
            hash = (element as HashedObject).hash();
        } else {
            hash = Hashing.forValue(HashedObject.literalizeField('', element).value);
        }

        return hash;
    }

    hashedElements : Map<Hash, T>;

    constructor(init?: IterableIterator<T>) {
        this.hashedElements = new Map();
        if (init !== undefined) {
            for (const member of init) {
                this.add(member);
            }
        }
    }

    add(element: T) {
        this.hashedElements.set(HashedSet.hash(element), element);
    }

    remove(element: T) : boolean {
        return this.removeByHash(HashedSet.hash(element));
    }

    removeByHash(hash: Hash) : boolean {
        return this.hashedElements.delete(hash);
    }

    has(element: T) {
        return this.hasByHash(HashedSet.hash(element));
    }

    hasByHash(hash: string) {
        return this.hashedElements.has(hash);
    }

    elements() : IterableIterator<T> {
        return this.hashedElements.values();
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
        for (let i=0; i<hashes.length; i++) {
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