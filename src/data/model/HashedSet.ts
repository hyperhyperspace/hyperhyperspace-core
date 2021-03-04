import { Hashing, Hash } from './Hashing';
import { HashedObject } from './HashedObject';
import { Context } from './Context';

import { Dependency } from './Literals';

class HashedSet<T> {

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
        this.hashedElements.set(HashedObject.hashElement(element), element);
    }

    remove(element: T) : boolean {
        return this.removeByHash(HashedObject.hashElement(element));
    }

    removeByHash(hash: Hash) : boolean {
        return this.hashedElements.delete(hash);
    }

    has(element: T) {
        return this.hasByHash(HashedObject.hashElement(element));
    }

    hasByHash(hash: Hash) {
        return this.hashedElements.has(hash);
    }

    get(hash: Hash) {
        return this.hashedElements.get(hash);
    }

    values() : IterableIterator<T> {
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

    fromArrays(_hashes: string[], elements: any[]) {
        for (let i=0; i<elements.length; i++) {
            this.add(elements[i]);
        }
    }

    equals(another: HashedSet<T>) {
        let hashes = Array.from(this.hashedElements.keys());
        hashes.sort();
        let anotherHashes = Array.from(another.hashedElements.keys());
        anotherHashes.sort();

        let result = hashes.length === anotherHashes.length;

        for(let i=0; result && i<hashes.length; i++) {
            result = result && hashes[i] === anotherHashes[i];
        }

        return result;
    }

    literalize(path='', context?: Context) : { value: any, dependencies : Set<Dependency> }  {
           
        let dependencies = new Set<Dependency>();

        let arrays = this.toArrays();
        let hashes = arrays.hashes;
        let child = HashedObject.literalizeField(path, arrays.elements, context);
        let elements = child.value;
        HashedObject.collectChildDeps(dependencies, child.dependencies);

        let value = {_type: 'hashed_set', _hashes: hashes, _elements: elements};

        return { value: value, dependencies: dependencies};
    }

    hash() {
        return Hashing.forValue(this.literalize().value);
    }

    size() {
        return this.hashedElements.size;
    }

    static deliteralize(value: any, context: Context, validate=false) : HashedSet<any> {
        
        if (value['_type'] !== 'hashed_set') {
            throw new Error("Trying to deliteralize value, but _type is '" + value['_type'] + "' (shoud be 'hashed_set')");
        }

        let hashes = value['_hashes'];
        let elements = HashedObject.deliteralizeField(value['_elements'], context, validate);
        
        let hset = new HashedSet();
        hset.fromArrays(hashes, elements);

        return hset;
    }

    static elementsFromLiteral(literal: {_elements: any[]}): any[] {
        return literal['_elements'];
        //return literal['_elements'].map((elmtValue: {_hash: Hash}) => elmtValue['_hash']);
    }

}

export { HashedSet };