

// given a hash for an object, accept or reject peers who want to 
// receive state updates.

import { Hash } from 'data/model';
import { ObjectAccessRequest } from './ObjcetAccessRequest';

interface ObjectAccessAgent {

    getObjectHash(): Hash;

    createAccessRequest(): ObjectAccessRequest;
    evaluateAccessRequest(request: ObjectAccessRequest): boolean; 

}

export { ObjectAccessAgent }