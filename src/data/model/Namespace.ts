import { HashedObject } from "./HashedObject";
import { MutableObject } from './MutableObject';
import { stringify } from 'querystring';
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
        
        let newId =  Hashing.forString(this.getId() + '///' + name);
        mutable.setId(newId);

    }

}

export { Namespace };