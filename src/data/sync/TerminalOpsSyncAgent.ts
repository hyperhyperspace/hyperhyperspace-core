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
    acceptedMutationOpClasses: Array<String>;

    opCallback: (opHash: Hash) => Promise<void>;

    storedStateChangeCallbacks: Set<StoredStateChangeCallback>;

    constructor(objectHash: Hash, store: Store, acceptedMutationOpClasses : Array<string>) {
        this.objectHash = objectHash;
        this.store = store;
        this.acceptedMutationOpClasses = acceptedMutationOpClasses;
        this.storedStateChangeCallbacks = new Set();
        this.opCallback = async (opHash: Hash) => {
            let op = await this.store.load(opHash) as MutationOp;
            if (this.shouldAcceptMutationOp(op)) {
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
        let terminalOpsInfo = await this.store.loadTerminalOpsForMutable(this.objectHash);

        if (terminalOpsInfo === undefined) {
            terminalOpsInfo = {terminalOps: []};
        }

        return TerminalOpsState.create(this.objectHash, terminalOpsInfo.terminalOps);
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

    shouldAcceptMutationOp(object: HashedObject): boolean {
        return this.acceptedMutationOpClasses.indexOf(object.getClassName()) >= 0;
    }
    
}

export { TerminalOpsSyncAgent };