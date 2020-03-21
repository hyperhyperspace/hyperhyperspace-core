import { HashedObject } from "./HashedObject";
import { MutableObject } from './MutableObject';
import { Hashing } from './Hashing';

class Namespace extends HashedObject {

    id?: string;

    constructor() {
        super();
    }

    getId() {
        return this.id as string;
    }

    set(name: string, mutable: MutableObject) : void {
        
        if (this.id === undefined) {
            throw new Error('A namespace must have a defined ID before it can be used');
        }

        let newId =  Hashing.forString(this.getId() + '///' + name);
        mutable.setId(newId);

    }

}

export { Namespace };