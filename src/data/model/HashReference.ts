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
}

export { HashReference }