import { Store } from 'data/storage/Store';
import { TerminalOpsState } from './TerminalOpsState';
import { ObjectSyncAgent } from './ObjectSyncAgent';
import { Hash } from 'data/model/Hashing';
import { HashedObject } from 'data/model/HashedObject';
import { MutationOp } from 'data/model/MutationOp';

type StoredStateChangeCallback = (objectHash: string) => void;

class TerminalOpsSyncAgent implements ObjectSyncAgent {

    objectHash: Hash;
    store: Store;
    acceptMutation: (mutation: HashedObject) => Promise<boolean>;

    opCallback: (opHash: Hash) => void;

    storedStateChangeCallbacks: Set<StoredStateChangeCallback>;

    constructor(objectHash: Hash, store: Store, acceptMutation : (mutation: HashedObject) => Promise<boolean>) {
        this.objectHash = objectHash;
        this.store = store;
        this.acceptMutation = acceptMutation;
        this.storedStateChangeCallbacks = new Set();
        this.opCallback = async (opHash: Hash) => {
            let op = await this.store.load(opHash);
            let valid = await this.acceptMutation(op as MutationOp);
            if (valid) {
                for (const callback of this.storedStateChangeCallbacks) {
                    callback(this.objectHash);
                }    
            }
        };
    }

    activate() {
        this.store.watchReferences('target', this.objectHash, this.opCallback);
    }

    deactivate() {
        this.store.removeReferencesWatch('target', this.objectHash, this.opCallback);
    }

    getObjectHash(): string {
        return this.objectHash;
    }

    async getStoredState(): Promise<HashedObject> {
        let terminalOpHashes = await this.store.loadTerminalOpsForMutable(this.objectHash);

        if (terminalOpHashes === undefined) {
            terminalOpHashes = [];
        }

        return TerminalOpsState.create(this.objectHash, terminalOpHashes);
    }

    addStoredStateChangeCallback(callback: (objectHash: string) => void): void {
        this.storedStateChangeCallbacks.add(callback);
    }

    removeStoredStateChangeCallback(callback: (objectHash: string) => void): boolean {
        return this.storedStateChangeCallbacks.delete(callback);
    }

    async evaluateRemoteState(state: HashedObject): Promise<string[]> {
        let receivedObjectHash = (state as TerminalOpsState).objectHash;

        if (receivedObjectHash !== this.objectHash) {
            throw new Error("TerminalOpSyncAgent for object " + this.objectHash + " was asked to evaluate remote state corresponding to object " + receivedObjectHash);
        }

        let receivedOps = (state as TerminalOpsState).terminalOps;
        let missingOps = [];

        if (receivedOps !== undefined) {
            for (const opHash of receivedOps?.elements()) {
                let op = await this.store.load(opHash);
                if (op === undefined) {
                    missingOps.push(opHash);
                }
            }    
        }

        return missingOps;
    }

    shouldAcceptMutation(object: HashedObject): Promise<boolean> {
        return this.acceptMutation(object as MutationOp);
    }
    
}

export { TerminalOpsSyncAgent };