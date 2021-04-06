import { Store } from 'storage/store';

import { HashedObject } from './HashedObject';
import { Context } from './Context';
import { MutationOp } from './MutationOp';
import { Hash } from './Hashing';
import { Logger, LogLevel } from 'util/logging';
import { CausalHistorySyncAgent, StateSyncAgent } from 'mesh/agents/state';
import { PeerGroupAgent } from 'mesh/agents/peer';
//import { ObjectStateAgent } from 'sync/agents/state/ObjectStateAgent';
//import { TerminalOpsStateAgent } from 'sync/agents/state/TerminalOpsStateAgent';

type LoadStrategy = 'none'|'full'|'lazy';

abstract class MutableObject extends HashedObject {

    static controlLog = new Logger(MutableObject.name, LogLevel.INFO)
    static prevOpsComputationLog = new Logger(MutableObject.name, LogLevel.INFO);

    readonly _acceptedMutationOpClasses : Array<string>;
    readonly _loadStrategy              : LoadStrategy;

    _boundToStore  : boolean;
    _unsavedOps    : Array<MutationOp>;
    _prevOpsForUnsavedOps : Set<Hash>;

    _opCallback : (hash: Hash) => Promise<void>;

    // If anyone using this mutable object needs to be notified whenever it changes,
    // an external mutation callback should be registered below.
    _externalMutationCallbacks : Set<(mut: MutationOp) => void>;

    constructor(acceptedOpClasses : Array<string>, load: LoadStrategy = 'full') {
        super();
        
        this._acceptedMutationOpClasses = acceptedOpClasses;
        this._loadStrategy = load;
        this._boundToStore = false;
        this._unsavedOps  = [];
        this._prevOpsForUnsavedOps = new Set();

        this._opCallback = async (hash: Hash) => {
            await this.applyOpFromStore(hash);
        };

        this._externalMutationCallbacks = new Set();
    }

    abstract mutate(op: MutationOp, isNew: boolean): Promise<boolean>;

    addMutationCallback(cb: (mut: MutationOp) => void) {
        this._externalMutationCallbacks.add(cb);
    }

    deleteMutationCallback(cb: (mut: MutationOp) => void) {
        this._externalMutationCallbacks.delete(cb);
    }

    watchForChanges(auto: boolean): boolean {
        if (auto) {
            this.bindToStore();
        } else {
            this.unbindFromStore();
        }

        return this._boundToStore;
    }

    private bindToStore() {
        // NOTE: watchReferences is idempotent
        this.getStore().watchReferences('target', this.getLastHash(), this._opCallback);
        this._boundToStore = true;
    }

    private unbindFromStore() {
        this.getStore().removeReferencesWatch('target', this.getLastHash(), this._opCallback);
        this._boundToStore = false;
    }

    // TODO: if this object is bound to the store while the load takes place, we could take measures
    //       to try to avoid loading objects twice if they arrive while the load takes place.
    //       As it is now, the implementation should prepare for the event of an op being loaded twice.

    async loadOperations(limit?: number, start?: string) : Promise<void> {
        if (this._loadStrategy === 'none') {
            throw new Error("Trying to load operations from store, but load strategy was set to 'none'");
        } else if (this._loadStrategy === 'full') {

            if (limit !== undefined) {
                throw new Error("Trying to load " + limit + " operations from store, but load strategy was set to 'full' - you should use 'lazy' instead");
            }

            if (start !== undefined) {
                throw new Error("Trying to load operations from store starting at " + start + " but load strategy was set to 'full' - you should use 'lazy' instead");
            }

            await this.loadAllChanges();
        } else if (this._loadStrategy === 'lazy') {
            await this.loadLastOpsFromStore(limit, start);
        }

    }

    async loadAllChanges() {
        
        let batchSize = 50;

        let results = await this.getStore()
                                .loadByReference(
                                    'target', 
                                    this.getLastHash(), 
                                    {
                                        order: 'asc',
                                        limit: batchSize
                                    });

        while (results.objects.length > 0) {

            for (const obj of results.objects) {
                const op = obj as MutationOp;
                await this.apply(op, false);
            }

            results = await this.getStore()
                                .loadByReference(
                                    'target', 
                                    this.getLastHash(), 
                                    {
                                        order: 'asc',
                                        limit: batchSize,
                                        start: results.end
                                    });
        }
    }

    async loadAndWatchForChanges() {
        this.watchForChanges(true);
        await this.loadAllChanges();
    }

    async loadLastOpsFromStore(limit?: number, start?: string): Promise<{results: number, last?: string}> {

        let count = 0;

        let params: any = { order: 'desc', limit: limit };
        
        if (start !== undefined) { params.start = start };

        let results = await this.getStore()
                                .loadByReference(
                                    'target', 
                                    this.getLastHash(), 
                                    params);
        
        for (const obj of results.objects) {
            let op = obj as MutationOp;

            if (this.shouldAcceptMutationOp(op)) {
                this.apply(op, false);
                count = count + 1;
            }
        }

        return {results: count, last: results.end}
    }


    async applyOpFromStore(hash: Hash) : Promise<void> {
        let op: MutationOp;

        op = await this.getStore().load(hash) as MutationOp;
        
        await this.apply(op, false);
    }

    async applyNewOp(op: MutationOp) : Promise<void> {

        if (!this.shouldAcceptMutationOp(op)) {
            throw new Error ('Invalid op ' + op.hash() + ' attempted for ' + this.hash());
        } else {

            op.setTarget(this);

            let prevOps = op.getPrevOpsIfPresent();

            let terminalOpHashes = new Set<Hash>();

            if (prevOps === undefined) {


                MutableObject.prevOpsComputationLog.debug(
                    () => 'automatically generating prev ops, target is ' + op.getTarget().hash()
                );

                // If prevOps is missing in the received object, we'll autogenerate a set of known
                // operations as follows: take all the terminal operations in the store (if there is
                // an attached store), of those remove any operations that are prevOps for all the
                // operations that are queued for storage (they are kept in this._prevOpsForUnsavedOps)
                // and add the last operation that is queued for storage (if there were any).

                // The invariant is: this._prevOpsForUnsavedOps holds all the operations that are terminal
                // in the store (*), but already have a successor in the chain of ops queued for saving.

                // (*) At the time this function was last called.

                if (this.hasStore()) {
                    const terminalOpsInfo = await this.getStore().loadTerminalOpsForMutable(op.getTarget().hash());
                    if (terminalOpsInfo !== undefined) {
                        for (const opHash of terminalOpsInfo.terminalOps) {
                            terminalOpHashes.add(opHash);
                        }    
                    }    
                }

                MutableObject.prevOpsComputationLog.trace('fetched ops from attached store (if any): ' + Array.from(terminalOpHashes));
                MutableObject.prevOpsComputationLog.trace('prev ops covered by unsaved ops (if any): ' + Array.from(this._prevOpsForUnsavedOps));
                
                for (const opHash of this._prevOpsForUnsavedOps) {
                    terminalOpHashes.delete(opHash);
                }

                MutableObject.prevOpsComputationLog.trace('remaining ops from attached store:        ' + Array.from(terminalOpHashes))

                let terminalOps = new Set<MutationOp>();

                for (const opHash of terminalOpHashes) {
                    let terminalOp = await this.getStore().load(opHash) as MutationOp;
                    terminalOps.add(terminalOp);
                }

                if (this._unsavedOps.length > 0) {

                    let last = this._unsavedOps[this._unsavedOps.length - 1];
                    MutableObject.prevOpsComputationLog.trace(() => 'adding last unsaved op:                    ' + last.hash());
                    
                    terminalOps.add(last);
                }
                
                MutableObject.prevOpsComputationLog.trace(() => 'resulting generated prev ops:              ' + Array.from(terminalOps).map((mut:MutationOp) => mut.hash()));
                op.setPrevOps(terminalOps.values());

                MutableObject.prevOpsComputationLog.debug(() => 'op ' + op.hash() + ' generated prev ops: ' + Array.from(terminalOps).map((mut:MutationOp) => mut.hash()))
            }            

            await this.apply(op, true);

            for (let opHash of terminalOpHashes) {
                this._prevOpsForUnsavedOps.add(opHash);
            }

            this.enqueueOpToSave(op);
        }
    }

    protected async apply(op: MutationOp, isNew: boolean) : Promise<void> {
        const mutated = await this.mutate(op, isNew);

        if (mutated) {
            for (const cb of this._externalMutationCallbacks) {
                cb(op);
            }
        }
    }


    async saveQueuedOps(store?: Store) : Promise<boolean> {

        if (store === undefined) {
            store = this.getStore();
        } else {
            this.setStore(store);
        }

        if (this._unsavedOps.length === 0) {
            return false;
        } else {
            while (this._unsavedOps.length > 0) {

                let op = this._unsavedOps.shift() as MutationOp;
                
                try {
                    await store.save(op);
                } catch (e) {
                    this._unsavedOps.unshift(op);
                    MutableObject.controlLog.debug(() => 'Error trying to save op for ' + this.hash() + ' (class: ' + this.getClassName() + ').');
                    throw e;
                }
                
                let prevOps = op.getPrevOpsIfPresent();
                if (prevOps !== undefined) {
                    for (const prevOp of prevOps) {
                        this._prevOpsForUnsavedOps.delete(prevOp.hash);
                    }
                }
            }

            return true;
        }

    }

    protected enqueueOpToSave(op: MutationOp) : void {
        this._unsavedOps.push(op);
    }

    literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('mutable');

        return super.literalizeInContext(context, path, flags);

    }

    shouldAcceptMutationOp(op: MutationOp) {
        return this._acceptedMutationOpClasses.indexOf(op.getClassName()) >= 0;
    }

    createSyncAgent(peerGroupAgent: PeerGroupAgent) : StateSyncAgent {
        return new CausalHistorySyncAgent(peerGroupAgent, this.getLastHash(), this.getStore(), this._acceptedMutationOpClasses);
        //return new TerminalOpsSyncAgent(peerGroupAgent, this.getLastHash(), this.getStore(), this._acceptedMutationOpClasses);
    }

    getAcceptedMutationOpClasses() : Array<string> {
        return this._acceptedMutationOpClasses;
    }

}

export { MutableObject }