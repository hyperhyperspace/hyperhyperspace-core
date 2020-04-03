import { Hash } from '../Hashing';
import { MutableObject, StateCallback } from '../MutableObject';

class SharedState {

    private mutables   : Map<Hash, MutableObject>;

    // callback used to monitor the mutables currently in this SharedState,
    // passed to every mutable in the map above.
    private mutableStateCallback : StateCallback;
    
    // callbacks to be called when any of the mutables above informs a state change.
    private sharedStateCallbacks : Set<StateCallback>;

    constructor() {
        this.mutables = new Map();

        this.mutableStateCallback = (hash: Hash) => {
            for (const callback of this.sharedStateCallbacks) {
                callback(hash);
            }
        };

        this.sharedStateCallbacks = new Set();
    }

    add(mutable: MutableObject) : void {
        this.mutables.set(mutable.getStoredHash(), mutable);
        mutable.watchState(this.mutableStateCallback);
    }

    remove(mutable: MutableObject) : boolean {
        mutable.removeStateWatch(this.mutableStateCallback);
        return this.removeByHash(mutable.hash());
    }

    removeByHash(hash: Hash) : boolean {
        let mutable = this.mutables.get(hash);
        if (mutable !== undefined) mutable.removeStateWatch(this.mutableStateCallback);
        return this.mutables.delete(hash);
    }

    get(hash: Hash) : MutableObject | undefined {
        return this.mutables.get(hash);
    }

    getAll() : Map<Hash, MutableObject> {
        return new Map(this.mutables.entries());
    }

    watchState(callback: StateCallback) {
        this.sharedStateCallbacks.add(callback);
    }

    removeStateWatch(callback: StateCallback) : boolean {
        return this.sharedStateCallbacks.delete(callback);
    }
}

export { SharedState }