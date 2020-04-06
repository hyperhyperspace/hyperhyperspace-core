import { Hash } from 'data/model/Hashing';
import { HashedObject } from 'data/model/HashedObject';


// given a hash for an object, derive its state from the local store & inform
// via a callback whenever that state has changed.

interface ObjectSyncAgent {
    
    // get the hash of the object that is being observerd by this instance.
    getObjectHash(): Hash;

    // get a HashedObject representing the observed object's local state.
    getStoredState() : Promise<HashedObject>;

    // invoke callback whenever this object's local state has changed,
    // indicating the object's own hash (so the callback can be shared).
    watchStoredState(callback: ((objectHash: Hash) => void)) : void;
    removeStoredStateWatch(callback: ((objectHash: Hash) => void)) : boolean;



    // evaluation of remote state: see if any objects should be fetched from remote peer
    //                             and return their hashes.
    evaluateRemoteState(state: HashedObject) : Promise<Array<Hash>>;

    // indicate whether a remote object is a valid mutation for the object we
    // are wathing.
    shouldAcceptMutation(object: HashedObject) : Promise<boolean>;
}

export { ObjectSyncAgent }