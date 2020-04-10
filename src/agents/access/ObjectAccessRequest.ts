import { HashedObject, Hash } from 'data/model';


abstract class ObjectAccessRequest extends HashedObject {
    
    abstract getObjectHash(): Hash;

}

export { ObjectAccessRequest }