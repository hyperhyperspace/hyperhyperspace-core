import { Hashing, Hash } from '../hashing/Hashing';
import { HashedObject } from './HashedObject';
import { Context } from '../literals/Context';

import { Dependency } from '../literals/LiteralUtils';

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

    literalize(path='', context?: Context) : { value: any, dependencies : Map<Hash, Dependency> }  {
           
        let dependencies = new Map<Hash, Dependency>();

        if (context === undefined) {
            context = new Context();
        }

        let arrays = this.toArrays();
        let hashes = arrays.hashes;
        let child = HashedObject.literalizeField('', arrays.elements, context);
        let elements = child.value;
        HashedObject.collectChildDeps(dependencies, path, child.dependencies, true);

        let value = {_type: 'hashed_set', _hashes: hashes, _elements: elements};

        return { value: value, dependencies: dependencies};
    }

    hash() {
        return Hashing.forValue(this.literalize().value);
    }

    size() {
        return this.hashedElements.size;
    }


    // NOTE ABOUT VALIDATION.
    
    // There is no validation step for deliteralize, but if the object came from an unstrusted source,
    // it will be re-hashed after reconstruction to check if the advertised hash was correct.
    // Hence if the hashes in the array were not sorted as they should, they will be when the object
    // is re-hashed, the hashes will not match and the object will be discarded.

    static deliteralize(value: any, context: Context, validate=false) : HashedSet<any> {
        
        if (value['_type'] !== 'hashed_set') {
            throw new Error("Trying to deliteralize value, but _type is '" + value['_type'] + "' (shoud be 'hashed_set')");
        }

        if (validate && Object.keys(value).length !== 3) {
            throw new Error('HashedSet literal values should have exactly 3 keys, found ' + Object.keys(value));
        }

        let hashes = value['_hashes'];
        let elements = HashedObject.deliteralizeField(value['_elements'], context, validate);

        if (validate && hashes.length !== elements.length) {
            throw new Error('HashedSet hashes and elements arrays have different lengths');
        }
        
        let hset = new HashedSet();
        hset.fromArrays(hashes, elements);
        
        if (validate) {

            let another = new HashedSet();
            for (const element of elements) {
                another.add(element);
            }

            if (!hset.equals(another)) {
                throw new Error('HashedSet failed validation: reconstruction resulted in a different set.');
            }

        }

        return hset;
    }

    static elementsFromLiteral(literal: {_elements: any[]}): any[] {
        return literal['_elements'];
        //return literal['_elements'].map((elmtValue: {_hash: Hash}) => elmtValue['_hash']);
    }

}

export { HashedSet };