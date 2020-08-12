import { HashedObject } from './HashedObject';
import { MutableObject } from './MutableObject';

class Namespace {

    id: string;
    definitions: Map<string, MutableObject>;

    constructor(id: string) {
        this.id = id;
        this.definitions = new Map();
    }

    define(key: string, mut: MutableObject) {
        mut.setId(HashedObject.generateIdForPath(this.id, key));
        this.definitions.set(key, mut);
    }

    get(key: string) : MutableObject | undefined {
        return this.definitions.get(key);
    }

    getAll() : IterableIterator<MutableObject> {
        return this.definitions.values();
    }    

}

export { Namespace }