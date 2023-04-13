import { Hash } from '../hashing/Hashing'
import { HashedObject } from './HashedObject';


// FIXME: can className be used to induce unwanted malleability? Validating that it is correct in
//        validate seems awkward, at least automatically - would require to de-structure the
//        object again it seems :-P

// if that's the case better stick to just using the hash

class HashReference<_T extends HashedObject> {
    hash      : Hash;
    className : string;
    
    constructor(hash: Hash, className: string) {
        this.hash = hash;
        this.className = className;
    }

     //static create(target: T) {
     //   return new HashReference<T>(target.hash(), target.getClassName());
     //}

    literalize() {
        return { _type: 'hashed_object_reference', _hash: this.hash, _class: this.className };
    }
    
    static deliteralize(literal: { _type: 'hashed_object_reference', _hash: Hash, _class: string }) {
        return new HashReference<HashedObject>(literal._hash, literal._class);
    }

    static hashFromLiteral(literal: { _hash: Hash }) {
        return literal._hash;
    }

    static classNameFromLiteral(literal: { _class: string }) {
        return literal._class;
    }
}

export { HashReference }