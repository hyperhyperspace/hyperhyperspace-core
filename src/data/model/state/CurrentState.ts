import { Hash } from '../Hashing';
import { MutableObject, StateCallback } from '../MutableObject';

class CurrentState {

    private mutables : Map<Hash, MutableObject>;

    // callbacks used to monitor the CurrentState mutables
    private mutableStateCallback : StateCallback;
    
    // callbacks to be called upon state changes
    private currentStateCallbacks : Set<StateCallback>;

    constructor() {
        this.mutables = new Map();

        this.mutableStateCallback = (hash: Hash) => {
            for (const callback of this.currentStateCallbacks) {
                callback(hash);
            }
        };

        this.currentStateCallbacks = new Set();
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
        this.currentStateCallbacks.add(callback);
    }
}

export { CurrentState }