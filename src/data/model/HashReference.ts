import { Hash } from './Hashing'
import { HashedObject } from './HashedObject';


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
}

export { HashReference }