import { HashedObject } from "./HashedObject";

class Namespace {

    id: string;
    definitions: Map<string, HashedObject>;

    constructor(id: string) {
        this.id = id;
        this.definitions = new Map();
    }

    define(key: string, object: HashedObject) {
        object.setId(HashedObject.generateIdForPath(this.id, key));
        this.definitions.set(key, object);
    }

    getAll() : IterableIterator<HashedObject> {
        return this.definitions.values();
    }    

}

export { Namespace }