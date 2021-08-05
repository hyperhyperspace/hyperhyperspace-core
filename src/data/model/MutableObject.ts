import { Store } from 'storage/store';

import { HashedObject } from './HashedObject';
import { Context } from './Context';
import { MutationOp } from './MutationOp';
import { Hash } from './Hashing';
import { Logger, LogLevel } from 'util/logging';
import { CausalHistorySyncAgent, StateSyncAgent, StateFilter } from 'mesh/agents/state';
import { PeerGroupAgent } from 'mesh/agents/peer';
import { HashedSet } from './HashedSet';
import { HashReference } from './HashReference';
import { Lock } from 'util/concurrency';
import { MultiMap } from 'util/multimap';
import { Resources } from 'spaces/Resources';
//import { ObjectStateAgent } from 'sync/agents/state/ObjectStateAgent';
//import { TerminalOpsStateAgent } from 'sync/agents/state/TerminalOpsStateAgent';

abstract class MutableObject extends HashedObject {

    static controlLog = new Logger(MutableObject.name, LogLevel.INFO)
    static prevOpsComputationLog = new Logger(MutableObject.name, LogLevel.INFO);

    readonly _acceptedMutationOpClasses : Array<string>;
    readonly _supportsUndo: boolean;

    _boundToStore : boolean;

    _allAppliedOps : Set<Hash>;
    _terminalOps   : Map<Hash, HashReference<MutationOp>>;
    _undoOpsPerOp       : MultiMap<Hash, Hash>;


    _unsavedOps      : Array<MutationOp>;
    _unappliedOps    : Map<Hash, MutationOp>;

    _applyOpsLock : Lock;

    _opCallback : (hash: Hash) => Promise<void>;

    // If anyone using this mutable object needs to be notified whenever it changes,
    // an external mutation callback should be registered below.
    _externalMutationCallbacks : Set<(mut: MutationOp) => void>;

    constructor(acceptedOpClasses : Array<string>, supportsUndo=false) {
        super();

        this._supportsUndo = supportsUndo;

        if (supportsUndo) {
            if (acceptedOpClasses.indexOf(UndoOp.className) < 0) {
                acceptedOpClasses.push(UndoOp.className);
            }
            if (acceptedOpClasses.indexOf(RedoOp.className) < 0) {
                acceptedOpClasses.push(RedoOp.className);
            }
        }
        
        this._acceptedMutationOpClasses = acceptedOpClasses;
        this._boundToStore = false;

        this._allAppliedOps = new Set();
        this._terminalOps   = new Map();
        this._undoOpsPerOp  = new MultiMap();

        this._unsavedOps      = [];
        this._unappliedOps    = new Map();
        
        this._applyOpsLock = new Lock();

        this._opCallback = async (hash: Hash) => {
            await this.applyOpFromStore(hash);
        };

        this._externalMutationCallbacks = new Set();
    }

    abstract mutate(op: MutationOp, isNew: boolean): Promise<boolean>;

    async undo(op: MutationOp, isNew: boolean): Promise<boolean> {
        op; isNew;

        throw new Error('Class "' + this.getClassName() + '" does not support operation undo, yet one was received.');
    }

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
        this.getStore().watchReferences('targetObject', this.getLastHash(), this._opCallback);
        this._boundToStore = true;
    }

    private unbindFromStore() {
        this.getStore().removeReferencesWatch('targetObject', this.getLastHash(), this._opCallback);
        this._boundToStore = false;
    }

    // TODO: if this object is bound to the store while the load takes place, we could take measures
    //       to try to avoid loading objects twice if they arrive while the load takes place.
    //       As it is now, the implementation should prepare for the event of an op being loaded twice.
    /*
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
    */

    async loadAllChanges() {
        
        let batchSize = 50;

        let results = await this.getStore()
                                .loadByReference(
                                    'targetObject', 
                                    this.getLastHash(), 
                                    {
                                        order: 'asc',
                                        limit: batchSize
                                    });

        while (results.objects.length > 0) {

            for (const obj of results.objects) {
                if (obj instanceof MutationOp) {
                    await this.apply(obj, false);
                }
            }

            results = await this.getStore()
                                .loadByReference(
                                    'targetObject', 
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
                                    'targetObject', 
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

        if (!this._allAppliedOps.has(hash) && !this._unappliedOps.has(hash)) {
            op = await this.getStore().load(hash) as MutationOp;

            this._unappliedOps.set(hash, op);
            
            this.applyPendingOpsFromStore();
        }

    }

    private async applyPendingOpsFromStore() {

        let go = true;

        while (go) {

            if (this._applyOpsLock.acquire()) {

                const pending = Array.from(this._unappliedOps.entries());
                
                go = false;

                const toRemove = new Array<Hash>();
                
                for (const [hash, op] of pending) {
                    if (this.canApplyOp(op)) {
                        await this.apply(op, false);
                        toRemove.push(hash);
                        go = true;
                    }
                }

                go = go || this._unappliedOps.size > pending.length;

                for (const hash of toRemove) {
                    this._unappliedOps.delete(hash);
                }

                this._applyOpsLock.release();
    
            }

        }

    }

    applyNewOp(op: MutationOp) : Promise<void> {

        if (!this.shouldAcceptMutationOp(op)) {
            throw new Error ('Invalid op ' + op.hash() + ' attempted for ' + this.hash());
        } else {

            op.setTargetObject(this);

            let prevOps = op.getPrevOpsIfPresent();

            if (prevOps === undefined) {
                op.prevOps = new HashedSet<HashReference<MutationOp>>();

                for (const ref of this._terminalOps.values()) {
                    op.prevOps.add(ref);
                }
            } else {
                for (const prevOpRef of op.getPrevOps()) {
                    if (!this._allAppliedOps.has(prevOpRef.hash)) {
                        throw new Error('Cannot apply new op ' + op.hash() + ': it has prevOp ' + prevOpRef.hash + ' that has not been applied yet.');
                    }
                }
            }
            
            const done = this.apply(op, true);

            this.enqueueOpToSave(op);

             return done;
        }
    }

    protected apply(op: MutationOp, isNew: boolean) : Promise<void> {

        const opHash = op.hash();

        for (const prevOpRef of op.getPrevOps()) {
            this._terminalOps.delete(prevOpRef.hash);
        }

        this._terminalOps.set(opHash, op.createReference());

        if (this._allAppliedOps.has(opHash)) {
            return Promise.resolve();
        }

        this._allAppliedOps.add(opHash);

        
        if (op instanceof UndoOp) {

            const targetOp     = op.targetOp as MutationOp;
            const targetOpHash = targetOp.hash();

            const alreadyUndone = this._undoOpsPerOp.get(targetOpHash).size > 0;

            this._undoOpsPerOp.add(targetOpHash, opHash);

            if (!alreadyUndone) {
                const done = this.undo(targetOp, isNew).then((mutated: boolean) => {
                    if (mutated) {
                        for (const cb of this._externalMutationCallbacks) {
                            cb(op);
                        }
                    }
                });
    
                return done;    
            } else {
                return Promise.resolve();
            }

        } else {

            let targetOp = op;
            let needToApply = true;

            if (op instanceof RedoOp) {

                const targetUndoOp     = op.targetOp as UndoOp;
                const targetUndoOpHash = targetUndoOp.hash();

                targetOp = targetUndoOp.targetOp as MutationOp;

                const targetOpHash = targetOp.hash();

                const wasUndone = this._undoOpsPerOp.get(targetOpHash).size > 0;
                
                this._undoOpsPerOp.delete(targetOpHash, targetUndoOpHash);

                const shouldRedo = wasUndone && this._undoOpsPerOp.get(targetOpHash).size === 0;

                needToApply = shouldRedo;

            }

            if (needToApply) {
                const done = this.mutate(targetOp, isNew).then((mutated: boolean) => {
                    if (mutated) {
                        for (const cb of this._externalMutationCallbacks) {
                            cb(targetOp);
                        }
                    }        
                });
        
                return done;
            } else {
                return Promise.resolve();
            }
            
        }
    }

    private canApplyOp(op: MutationOp): boolean {

        let ok = true;
        for (const prevOp of op.getPrevOps()) {
            if (!this._allAppliedOps.has(prevOp.hash)) {
                ok = false;
                break
            }
        }

        return ok;
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
                    await store.save(op, false);
                } catch (e) {
                    this._unsavedOps.unshift(op);
                    MutableObject.controlLog.debug(() => 'Error trying to save op for ' + this.hash() + ' (class: ' + this.getClassName() + ').');
                    throw e;
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

        if (this._supportsUndo) {
            flags.push('supports_undo')
        }

        return super.literalizeInContext(context, path, flags);

    }

    shouldAcceptMutationOp(op: MutationOp) {
        return this._acceptedMutationOpClasses.indexOf(op.getClassName()) >= 0 && op.getTargetObject().equals(this);
    }

    createSyncAgent(peerGroupAgent: PeerGroupAgent) : StateSyncAgent {
        return new CausalHistorySyncAgent(peerGroupAgent, this.getLastHash(), this.getResources() as Resources, this._acceptedMutationOpClasses, this.getSyncAgentStateFilter());
        //return new TerminalOpsSyncAgent(peerGroupAgent, this.getLastHash(), this.getStore(), this._acceptedMutationOpClasses);
    }

    getSyncAgentStateFilter() : StateFilter | undefined {
        return undefined;
    }

    getAcceptedMutationOpClasses() : Array<string> {
        return this._acceptedMutationOpClasses;
    }

}

export { MutableObject }