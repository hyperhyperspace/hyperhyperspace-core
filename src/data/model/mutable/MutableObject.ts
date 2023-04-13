import { Store } from 'storage/store';

import { HashedObject } from '../immutable/HashedObject';
import { Context } from '../literals/Context';
import { Hash } from '../hashing/Hashing';
import { Logger, LogLevel } from 'util/logging';
import { HeaderBasedSyncAgent, StateSyncAgent, StateFilter, SyncState, SyncObserver } from 'mesh/agents/state';
import { PeerGroupAgent } from 'mesh/agents/peer';
import { HashedSet } from '../immutable/HashedSet';
import { HashReference } from '../immutable/HashReference';
import { Lock } from 'util/concurrency';
import { MultiMap } from 'util/multimap';
import { Resources } from 'spaces/Resources';
import { CascadedInvalidateOp } from '../causal/CascadedInvalidateOp';
import { OpHeader } from '../../history/OpHeader';

import { MutationOp } from './MutationOp';
import { EventRelay, Observer } from 'util/events';
import { LiteralUtils, MutationEvent } from 'data/model';

//import { ObjectStateAgent } from 'sync/agents/state/ObjectStateAgent';
//import { TerminalOpsStateAgent } from 'sync/agents/state/TerminalOpsStateAgent';

enum CheckpointEvents {
    RestoredCheckpoint = 'restored-checkpoint'
}

enum MutableContentEvents {
    AddObject    = 'add-object',
    RemoveObject = 'remove-object'
};

const ContentChangeEventActions: Array<string> = [MutableContentEvents.AddObject, MutableContentEvents.RemoveObject];

enum OpInvalidationEvents {
    InvalidateOp = 'invalidate-op',
    RevalidateOp = 'revalidate-op'
}

const OpInvaidationEventActions: Array<string> = [OpInvalidationEvents.InvalidateOp, OpInvalidationEvents.RevalidateOp];

type MutableObjectConfig = {
    supportsCausalInvalidation?: boolean,
    supportsCheckpoints?: boolean,
    autoCheckpoint?: boolean,       // create checkpoints automatically?
    autoCheckpointOpFreq?: number,      // how many ops must be applied and saved before a checkpoint is created automatically
    autoCheckpointOpFreqDelay?: number  // how long to wait for more ops before doing so
    autoCheckpointInactivityDelay?: number,     // how much time must pass for a checkpoint to be created automatically, even if there are few applied ops
};

type StateCheckpoint = {
    mutableObject: Hash,
    terminalOpHashes: Array<Hash>,
    lastLoadedOpHash: Hash,
    loadedOpCount: number;
    allAppliedOps: Array<Hash>,
    activeCascInvsPerOp: Array<[Hash, Array<Hash>]>, 
    exportedState: any
};

const DEFAULT_AUTO_CHECK_OP_FREQ = 8;
const DEFAULT_AUTO_CHECK_OP_DELAY = 5;
const DEFAULT_AUTO_CHECK_INACT_DELAY = 60;

abstract class MutableObject extends HashedObject {

    static controlLog = new Logger(MutableObject.name, LogLevel.INFO)
    static prevOpsComputationLog = new Logger(MutableObject.name, LogLevel.INFO);

    readonly _acceptedMutationOpClasses : Array<string>;
    
    readonly _supportsCheckpoints: boolean;

    _autoCheckpointOpFreq: number;
    _autoCheckpointOpFreqDelay: number;

    _autoCheckpointInactivityDelay: number;

    readonly _autoCheckpointCallback: () => void;

    _autoCheckpoint: boolean;
    
    _autoCheckpointOpTimer: any;
    _autoCheckpointInactivityTimer: any;

    _allAppliedOps : Set<Hash>;
    _terminalOps   : Map<Hash, MutationOp>;

    // For causal deps: we only keep track of inv. for the op at the very end of
    // an undo / redo chain (e.g. for each causal dep an op has,
    // only an undo op at the very end of the chain can be in
    // _activeCascInvsPerOp).
    _activeCascInvsPerOp       : MultiMap<Hash, Hash>;

    _unsavedOps      : Array<MutationOp>;
    _unappliedOps    : Map<Hash, MutationOp>;

    _lastLoadedOpHash? : Hash;
    _lastLoadedOpHashAtCheckpoint?: Hash;
    _loadedOpCount: number;
    _loadedOpCountAtCheckpoint?: number;

    _applyOpsLock : Lock;

    _opCallback : (hash: Hash) => Promise<void>;

    // If anyone using this mutable object needs to be notified whenever an op is applied,
    // an external mutation callback should be registered below.
    _externalMutationCallbacks : Set<(mut: MutationOp) => void>;

    _cascadeMutableContentObserver : Observer<HashedObject>;

    constructor(acceptedOpClasses : Array<string>, config?: MutableObjectConfig) {
        super();

        if (config?.supportsCausalInvalidation || false) {
            if (acceptedOpClasses.indexOf(CascadedInvalidateOp.className) < 0) {
                acceptedOpClasses.push(CascadedInvalidateOp.className);
            }
        }

        this._supportsCheckpoints   = config?.supportsCheckpoints || false;
        this._autoCheckpoint        = config?.autoCheckpoint || true;

        this._autoCheckpointOpFreq      = config?.autoCheckpointOpFreq || DEFAULT_AUTO_CHECK_OP_FREQ;
        this._autoCheckpointOpFreqDelay = config?.autoCheckpointOpFreqDelay || DEFAULT_AUTO_CHECK_OP_DELAY;

        this._autoCheckpointInactivityDelay     = config?.autoCheckpointInactivityDelay || DEFAULT_AUTO_CHECK_INACT_DELAY;

        this._autoCheckpointCallback = async () => {
            const store = this.getStore();

            this.clearAutoCheckpointInactivityTimer();
            this.clearAutoCheckpointOpTimer();

            //console.log('callback!')

            if (store !== undefined) {
                if (this._unsavedOps.length > 0) {
                    // we need to reschedule a retry!
                    this.setAutoCheckpointTimers();
                    //console.log('delay 1!')
                } else if (this._allAppliedOps.size > (this._loadedOpCountAtCheckpoint || 0)) {
                    // ok there are no unsaved changes

                    const prevCheckStartOp = this._lastLoadedOpHashAtCheckpoint;
                    const check = this.createCheckpoint();

                    let ready = this._loadedOpCount === this._allAppliedOps.size;

                    if (!ready) {
                        const storedOpHashes = await this.loadOpHashes(this._lastLoadedOpHashAtCheckpoint);

                        let includedOps = this._allAppliedOps;
    
                        if (prevCheckStartOp === this._lastLoadedOpHashAtCheckpoint) {
    
                            // only go ahead if a checkpoint was not created in the meantime
                        
                            if (includedOps.size === check.allAppliedOps.length) { 
                                
                                // ok there are no unsaved changes AND we were able to load all the ops in the store
                                // since the last checkpoint without this object being modified. looking GOOD
                                
                                let lastLoadedOpHash = this._lastLoadedOpHashAtCheckpoint;
                                let loadedAllOps = true;
                                
                                for (const opHash of storedOpHashes) {
                                    if (!this._allAppliedOps.has(opHash)) {
                                        // oops, the store has received changes for this object that we have not loaded,
                                        // and they could be missing from our checkpoint. let's bail out
                                        loadedAllOps = false;
                                    } else {
                                        lastLoadedOpHash = opHash;
                                    }
                                }
    
                                if (loadedAllOps) {
    
                                    // all good, it is safe to create a checkpoint from the contents of this instance
                                
                                    // we may need to amend the lastLoaded op in the checkpoint
                                    if (lastLoadedOpHash !== undefined) {
                                        check.lastLoadedOpHash = lastLoadedOpHash;
                                    }
                                    
                                    ready = true;
                                } else {
                                    //console.log('not all ops where loaded for ' + this.getLastHash())
                                }
    
                            } else {
                                // oops, more ops where applied while loadOpHashes was running
                                // again, we need to reschedule a retry!
                                this.setAutoCheckpointTimers();
                                //console.log('delay 2!')
                                
                            }
    
                        } else {
                            //console.log('a checkpoint was concurrently created for ' + this.getLastHash());
                        }
                    } else {
                        //console.log('checkpoint could be fast-approved for ' + this.getLastHash());
                    }

                    if (ready) {
                        this.doSaveCheckpoint(check);
                    }
                    
                } else {
                    //console.log('no changes to checkpoint for ' + this.getLastHash());
                }
            } else {
                //console.log('cancelling checkpoint (no store!) for ' + this.getLastHash());
            }
        }
        
        this._acceptedMutationOpClasses = acceptedOpClasses;
        this._boundToStore = false;

        this._allAppliedOps = new Set();
        this._terminalOps   = new Map();

        this._activeCascInvsPerOp = new MultiMap();

        this._unsavedOps      = [];
        this._unappliedOps    = new Map();
        
        this._applyOpsLock = new Lock();

        this._loadedOpCount = 0;

        this._opCallback = async (hash: Hash) => {
            await this.applyOpFromStore(hash);
        };

        this._externalMutationCallbacks = new Set();

        this._cascadeMutableContentObserver = (ev: MutationEvent) => {

            if (ev.emitter === this) {

                if (this.isCascadingMutableContentEvents()) {
                    if (ev.action === MutableContentEvents.AddObject) {
                        MutableObject.addEventRelayForElmt(this._mutationEventSource, ev.data.getLastHash(), ev.data);
                    } else if (ev.action === MutableContentEvents.RemoveObject) {
                        MutableObject.removeEventRelayForElmt(this._mutationEventSource, ev.data.getLastHash(), ev.data);
                    } else if (ev.action === CheckpointEvents.RestoredCheckpoint) {
                        this._mutationEventSource?.removeAllUpstreamRelays();
                        this.addEventRelaysForContents(this._mutationEventSource)   
                    }
                }

            }

        }
    }

    supportsCausalInvalidation() {
        return this._acceptedMutationOpClasses.indexOf(CascadedInvalidateOp.className) >= 0
    }

    abstract mutate(op: MutationOp, valid: boolean, cascade: boolean): Promise<boolean>;
    abstract getMutableContents(): MultiMap<Hash, HashedObject>;
    abstract getMutableContentByHash(hash: Hash): Set<HashedObject>;

    // override the following two to support checkpointing (and pass apropriate params in config to constructor)

    exportMutableState(): any {
        throw new Error(this.getClassName() + ': this class does not support exporting its state')
    }

    importMutableState(state: any) {
        state;
        throw new Error(this.getClassName() + ': this class does not support importing its state')
    }

    /*
    // override if appropiate
    async undo(op: MutationOp): Promise<boolean> {
        op; return true;
    }

    // override if appropiate
    async redo(op: MutationOp): Promise<boolean> {
        op; return true;
    }*/

    protected isValidOp(opHash: Hash): boolean {
        const valid = this._activeCascInvsPerOp.get(opHash).size === 0;

        return valid;
    }

    addMutationOpCallback(cb: (mut: MutationOp) => void) {
        this._externalMutationCallbacks.add(cb);
    }

    deleteMutationOpCallback(cb: (mut: MutationOp) => void) {
        this._externalMutationCallbacks.delete(cb);
    }

    toggleWatchForChanges(auto: boolean): boolean {

        const before = super.toggleWatchForChanges(auto);

        if (auto) {
            this.bindToStore();
        } else {
            this.unbindFromStore();
        }

        return before;
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

    // getOpHeader will correclty ge the headers for ops that are still unsaved too

    async getOpHeader(opHash: Hash): Promise<OpHeader> {

        const stack = new Array<Hash>();
        const cache = new Map<Hash, OpHeader>();

        const unsaved = new Map<Hash, MutationOp>();

        for (const op of this._unsavedOps) {
            unsaved.set(op.hash(), op);
        }

        stack.push(opHash);

        while (stack.length > 0) {
            const nextHash = stack[stack.length-1];

            if (cache.has(nextHash)) {

                // do nothing
                stack.pop();

            } else if (unsaved.has(nextHash)) {
                const op = unsaved.get(nextHash) as MutationOp;

                const prevOps= op.getPrevOpsIfPresent();
                let missing=false;

                if (prevOps !== undefined) {
                    for (const prevOpHash of prevOps) {
                        if (!cache.has(prevOpHash.hash)) {
                            stack.push(prevOpHash.hash);
                            missing = true;
                        }
                    }
                }

                if (!missing) {
                    const opHeader = op.getHeader(cache);
                    cache.set(stack.pop() as Hash, opHeader);
                }


            } else {
                const op = await this.getStore().loadOpHeader(stack.pop() as Hash);

                if (op === undefined) {
                    throw new Error('Trying to get op header for op ' + opHash + ', but it depends on op ' + nextHash + ' that is neither in the store or an unapplied op in ' + this.hash() + ' (a ' + this.getClassName() + ')');
                }

                cache.set(nextHash, op);
            }
        }

        return cache.get(opHash) as OpHeader;

    }

    private async loadOpHashes(startOn?: Hash, batchSize=512): Promise<Array<Hash>> {

        const opHashes: Array<Hash> = [];

        let results = await this.getStore()
                                .loadLiteralsByReference(
                                    'targetObject', 
                                    this.getLastHash(), 
                                    {
                                        order: 'asc',
                                        limit: batchSize,
                                        startOn: startOn
                                    });

        while (results.literals.length > 0) {
            for (const lit of results.literals) {
                if ( this._acceptedMutationOpClasses.indexOf(LiteralUtils.getClassName(lit)) >= 0) {
                    opHashes.push(lit.hash);
                }
            }

            results = await this.getStore()
                                .loadLiteralsByReference(
                                    'targetObject', 
                                    this.getLastHash(), 
                                    {
                                        order: 'asc',
                                        limit: batchSize,
                                        start: results.end
                                    });
        }

        return opHashes;

    }

    async loadAllChanges(batchSize=128, context = new Context()) {

        const initialLoadedOpCount = this._loadedOpCount;

        await super.loadAllChanges(batchSize, context);
        
        if (this._supportsCheckpoints && this._allAppliedOps.size === 0) {
            try {
                const checkpoint = await this.getStore().loadLastCheckpoint(this.getLastHash());

                if (checkpoint !== undefined && this._allAppliedOps.size === 0) {
                    //console.log('Restoring checkpoint for ' + this.getClassName() + ' ' + this.getLastHash() + ': ' + checkpoint.loadedOpCount + ' ops');
                    await this.restoreCheckpoint(checkpoint);
                }    
            } catch (e) {
                // Ignore for now
            }
        }

        let results = await this.getStore()
                                .loadByReference(
                                    'targetObject', 
                                    this.getLastHash(), 
                                    {
                                        order: 'asc',
                                        limit: batchSize,
                                        startOn: this._lastLoadedOpHash
                                    },
                                    context);

        while (results.objects.length > 0) {

            for (const obj of results.objects) {
                if (obj instanceof MutationOp && this.isAcceptedMutationOpClass(obj)) {
                    if (await this.apply(obj, false)) {
                        this._lastLoadedOpHash = obj.getLastHash();
                        this._loadedOpCount   = this._loadedOpCount + 1;
                    }
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
                                    },
                                    context);
        }


        let savedCheckpoint = false;

        if (this._supportsCheckpoints && this._autoCheckpoint && this._loadedOpCount === this._allAppliedOps.size) {
            if (this._loadedOpCount - (this._loadedOpCountAtCheckpoint || 0) >= this._autoCheckpointOpFreq) {
                const check = this.createCheckpoint();
                this.doSaveCheckpoint(check);
                savedCheckpoint = true;
            }
        }

        if (this._loadedOpCount > initialLoadedOpCount && !savedCheckpoint) {
            this.setAutoCheckpointTimers();
        }
    }

    async loadAndWatchForChanges(loadBatchSize=128) {

        await super.loadAndWatchForChanges(loadBatchSize);
        await this.loadAllChanges(loadBatchSize);
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

            if (this.isAcceptedMutationOpClass(op)) {
                this.apply(op, false);
                count = count + 1;
            }
        }

        return {results: count, last: results.end}
    }


    async applyOpFromStore(hash: Hash) : Promise<void> {
        let op: MutationOp;

        if (!this._allAppliedOps.has(hash) && !this._unappliedOps.has(hash)) {
            op = await this.getStore().load(hash, false, false) as MutationOp;
            
            if (op === undefined) {
                MutableObject.controlLog.warning('Attempting to apply op ' + hash + ' to object ' + this.hash() + ' (' + this.getClassName() + '), but it is missing from the store! Store backend: ' + this.getStore().getName() + ' using ' + this.getStore().getBackendName());
            }

            this._unappliedOps.set(hash, op);
            
            this.applyPendingOpsFromStore();
        }

    }

    private async applyPendingOpsFromStore() {

        let go = true;

        while (go) {

            if (this._applyOpsLock.acquire()) {

                try {
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
    
                } finally {
                    this._applyOpsLock.release();
                }
            } else {
                // If we fail to acquire the lock, then the loop above is already executing.
                // Since the loop will not exit until there are no more ops to process, we
                // can safely do nothing.
                go = false;
            }

        }

    }

    applyNewOp(op: MutationOp) : Promise<void> {

        if (!this.isAcceptedMutationOpClass(op)) {
            throw new Error ('Invalid op ' + op.hash() + ' attempted for ' + this.hash());
        } else {

            op.setTargetObject(this);
            if (this.hasResources() && ! op.hasResources()) {
                op.setResources(this.getResources() as Resources);
            }

            let prevOps = op.getPrevOpsIfPresent();

            if (prevOps === undefined) {
                op.prevOps = new HashedSet<HashReference<MutationOp>>();

                for (const termOp of this._terminalOps.values()) {
                    op.prevOps.add(termOp.createReference());
                }
            } else {
                for (const prevOpRef of op.getPrevOps()) {
                    if (!this._allAppliedOps.has(prevOpRef.hash)) {
                        throw new Error('Cannot apply new op ' + op.hash() + ': it has prevOp ' + prevOpRef.hash + ' that has not been applied yet.');
                    }
                }
            }

            op.hash(); // to ensure the's not an incorrect leftover cached hash value after the modifications above

            const done = this.apply(op, true);
            
            return done.then(() => {});                
        }
    }

    // returns true if the op was applied
    protected apply(op: MutationOp, isNew: boolean) : Promise<boolean> {

        const opHash = op.getLastHash();

        if (this._allAppliedOps.has(opHash)) {
            return Promise.resolve(false);
        }

        for (const prevOpRef of op.getPrevOps()) {
            this._terminalOps.delete(prevOpRef.hash);
        }

        this._terminalOps.set(opHash, op);

        this._allAppliedOps.add(opHash);

        if (isNew) {
            this.enqueueOpToSave(op);
        }

        let result = Promise.resolve(false);

        let shouldMutate       = true;
        let invalidationChange = false;
        let isValidNow         = true;
        let isCascade          = false;

        let finalTargetOp: MutationOp = op;
        
        if (op instanceof CascadedInvalidateOp) {

            finalTargetOp     = op.getFinalTargetOp();
            const finalTargetOpHash = finalTargetOp.hash();
            
            const wasValid = this.isValidOp(finalTargetOpHash);

            if (op.undo) {
                this._activeCascInvsPerOp.add(finalTargetOpHash, opHash);
            } else {
                this._activeCascInvsPerOp.delete(finalTargetOpHash, op.getTargetOp().hash());
            }

            isValidNow = this.isValidOp(finalTargetOpHash);
            isCascade  = op.targetOp instanceof CascadedInvalidateOp;

            invalidationChange = wasValid !== isValidNow;

            if (!invalidationChange) {
                shouldMutate = false;
            }
        }

        if (shouldMutate) {
            result = this.mutate(finalTargetOp, isValidNow, isCascade);
        }

        const done = result.then((mutated: boolean) => {
            if (mutated) {
                for (const cb of this._externalMutationCallbacks) {
                    cb(op);
                }
            }        
        });

        return done.then(() => {
            if (invalidationChange) {
                const action = isValidNow? OpInvalidationEvents.RevalidateOp : OpInvalidationEvents.InvalidateOp;
                this._mutationEventSource?.emit({emitter: this, action: action, data: finalTargetOp});
            }
            return true;
        });
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

    async save(store?: Store) : Promise<void> {
        await super.save(store);
    }


    // Deprecated! Use "saveAllChanges" instead.
    async saveQueuedOps(store?: Store) : Promise<boolean> {
        return this.saveAllChanges(store);
    }


    async saveAllChanges(store?: Store) : Promise<boolean> {

        if (store === undefined) {
            store = this.getStore();
        } else {
            if (this.getResources() === undefined) {
                this.setStore(store);
            }
        }

        //console.log('save! ' + this.getLastHash())

        if (this._unsavedOps.length === 0) {
            return false;
        } else {

            //console.log('effective save!')

            while (this._unsavedOps.length > 0) {

                let op = this._unsavedOps[0] as MutationOp;
                
                try {
                    await store.save(op, false);
                } catch (e) {
                    MutableObject.controlLog.debug(() => 'Error trying to save op for ' + this.hash() + ' (class: ' + this.getClassName() + ').');
                    throw e;
                }
                
                // This same op may have been saved and unshifted concurrently, check before unshifting
                // to avoid removing an unsaved op.
                if (op === this._unsavedOps[0]) {
                    this._unsavedOps.shift();
                }
                
            }

            this.setAutoCheckpointTimers();

            return true;
        }

    }

    async loadOp(opHash: Hash): Promise<MutationOp|undefined> {
        for (const op of this._unsavedOps) {
            if (op.hash() === opHash) {
                return op;
            }
        }

        return this.getStore().load(opHash, false, false) as Promise<MutationOp|undefined>;
    }

    protected setCurrentPrevOpsTo(op: MutationOp): void {

        op.setPrevOps(this._terminalOps.values());
    }

    protected enqueueOpToSave(op: MutationOp) : void {
        this._unsavedOps.push(op);
    }

    // checkpointing
    
    createCheckpoint(): StateCheckpoint {
        return {
            mutableObject: this.getLastHash(),
            terminalOpHashes: Array.from(this._terminalOps.keys()),
            lastLoadedOpHash: this._lastLoadedOpHash as Hash,
            loadedOpCount: this._loadedOpCount,
            allAppliedOps: Array.from(this._allAppliedOps), 
            activeCascInvsPerOp: Array.from(this._activeCascInvsPerOp.entries()).map((v: [Hash, Set<Hash>]) => [v[0], Array.from(v[1].values())]),
            exportedState: this.exportMutableState()
        };
    }

    async saveCheckpoint() : Promise<StateCheckpoint> {
        
        if (this._supportsCheckpoints) {

            this.clearAutoCheckpointOpTimer();
            this.clearAutoCheckpointInactivityTimer();
            

            // Checkpoints use the linearization of ops as they go into the store. We need to make sure that no ops were
            // saved and not loaded into this instance: otherwise we risk creating an inconsistent checkpoint (for example
            // if later ops were applied directly in this instance and then saved, that potentially creates a "hole" in the
            // checkpoint's history)

            let checkpoint: StateCheckpoint|undefined = undefined;

            if (this._unsavedOps.length === 0) {
                await this.loadAllChanges();
                checkpoint = this.createCheckpoint();
            }
            
            while (this._unsavedOps.length > 0) {
                await this.saveQueuedOps();
                await this.loadAllChanges();
                checkpoint = this.createCheckpoint();
            }

            // At this point, sice there are no unsaved ops and we've loaded everything in the store up to this._lastLoadedOpHash
            // we can ensure that the checkpoint will be consistent.

            return this.doSaveCheckpoint(checkpoint as StateCheckpoint); // we can ensure that a checkpoint was created above
        } else {
            throw new Error('A checkpoint was requested, but ' + this.getClassName() + ' does not support it.');
        }
    }

    private async doSaveCheckpoint(check: StateCheckpoint) : Promise<StateCheckpoint> {

        //console.log('Saving checkpoint for ' + this.getClassName() + ' ' + this.getLastHash() + ': ' + this._loadedOpCount + ' ops');
        this._loadedOpCountAtCheckpoint    = check.loadedOpCount;
        this._lastLoadedOpHashAtCheckpoint = check.lastLoadedOpHash;
        await this.getStore().saveCheckpoint(check);

        return check;

    }

    async restoreCheckpoint(checkpoint: StateCheckpoint) {

        if (this.getLastHash() !== checkpoint.mutableObject) {
            throw new Error('Trying to apply a state checkpoint to ' + this.getLastHash() + ', but the checkpoint is for ' + checkpoint.mutableObject);
        }

        //if (this._allAppliedOps.size > 0) {
        //    // oops, the object was modified since the restore was requested, we could "ghost" some operations if we do it now!
        //    throw new Error('Cannot restore checkpoint, the object has unsaved changes.');
        //}

        const terminalOps = new Map<Hash, MutationOp>();

        for (const opHash of checkpoint.terminalOpHashes.values()) {
            const op = await this.loadOp(opHash);

            if (op === undefined) {
                throw new Error('Cannot apply checkpoint to ' + this.getLastHash() + ', missing op: ' + opHash);
            }

            terminalOps.set(opHash, op);
        }

        this._terminalOps         = terminalOps;
        this._allAppliedOps       = new Set(checkpoint.allAppliedOps.values());
        this._activeCascInvsPerOp = new MultiMap();

        for (const [k, vs] of checkpoint.activeCascInvsPerOp) {
            for (const v of vs) {
                this._activeCascInvsPerOp.add(k, v);
            }
        }

        this._lastLoadedOpHash             = checkpoint.lastLoadedOpHash;
        this._lastLoadedOpHashAtCheckpoint = checkpoint.lastLoadedOpHash;

        this._loadedOpCount             = checkpoint.loadedOpCount;
        this._loadedOpCountAtCheckpoint = checkpoint.loadedOpCount;

        this.importMutableState(checkpoint.exportedState);

        const resources = this.getResources();
        if (resources) {
            // this.setResources(resources);
            for (const aliases of this.getMutableContents().values()) {
                for (const obj of aliases) {
                  obj.setResources(resources);
                }
              }
              
        }

        this._mutationEventSource?.emit({emitter: this, action: CheckpointEvents.RestoredCheckpoint, data: undefined});
    }


    literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('mutable');

        if (this.supportsCausalInvalidation()) {
            flags.push('supports_undo')
        }

        return super.literalizeInContext(context, path, flags);

    }

    isAcceptedMutationOpClass(op: MutationOp): boolean {
        return this._acceptedMutationOpClasses.indexOf(op.getClassName()) >= 0/* && op.getTargetObject().equals(this)*/;
    }

    // Override if necessary
    shouldAcceptMutationOp(op: MutationOp, opReferences: Map<Hash, HashedObject>): boolean {
        opReferences;
        return this.isAcceptedMutationOpClass(op);
    }

    toggleCascadeMutableContentEvents(enabled: boolean): boolean {
        const before = super.toggleCascadeMutableContentEvents(enabled);

        this.updateCascadeMutableContentRelays(this._mutationEventSource);

        return before;
    }

    protected createMutationEventSource(): EventRelay<HashedObject> {

        const ownMutationEventSource = super.createMutationEventSource();

        this.updateCascadeMutableContentRelays(ownMutationEventSource);

        return ownMutationEventSource;

    }

    private updateCascadeMutableContentRelays(ownMutationEventSource?: EventRelay<HashedObject>) {

        if (ownMutationEventSource !== undefined) {

            if (this.isCascadingMutableContentEvents()) {
                ownMutationEventSource.addObserver(this._cascadeMutableContentObserver);

                this.addEventRelaysForContents(ownMutationEventSource);
            } else {
                ownMutationEventSource.removeObserver(this._cascadeMutableContentObserver);

                this.removeEventRelaysForContents(ownMutationEventSource);
            }
        }
    }

    private static addEventRelayForElmt(own: EventRelay<HashedObject>|undefined, hash: Hash, elmt: any) {
        if (own !== undefined && elmt instanceof HashedObject) {
            own.addUpstreamRelay('contents[' + hash + ']', elmt.getMutationEventSource())
            //console.log('adding event relay for contents[' + hash + '] on ' + own.emitterHash);
        }
    }

    private static removeEventRelayForElmt(own: EventRelay<HashedObject>|undefined, hash: Hash, elmt: any) {
        if (own !== undefined && elmt instanceof HashedObject) {
            own.removeUpstreamRelay('contents[' + hash + ']');
            //console.log('removing event relay for contents[' + hash + '] on ' + own.emitterHash);
        }
    }

    private addEventRelaysForContents(own: EventRelay<HashedObject>|undefined, seen=new Set<HashedObject>()) {

        if (own !== undefined) {
            for (const [hash, aliases] of this.getMutableContents().entries()) {
                for (const elmt of aliases) {
                    if (!seen.has(elmt)) {
                        seen.add(elmt);
                        MutableObject.addEventRelayForElmt(own, hash, elmt);
                    }
                }
            }    
        }
    }

    private removeEventRelaysForContents(own: EventRelay<HashedObject>|undefined, seen=new Set<HashedObject>()) {

        if (own !== undefined) {
            for (const [hash, aliases] of this.getMutableContents().entries()) {
                for (const elmt of aliases) {
                    if (!seen.has(elmt)) {
                        seen.add(elmt);
                        MutableObject.removeEventRelayForElmt(own, hash, elmt);
                    }
                }
            }    
        }
    }

    private setAutoCheckpointTimers() {

        if (this._supportsCheckpoints && this._autoCheckpoint && this._allAppliedOps.size > 0) {

            this.clearAutoCheckpointInactivityTimer();

            if (this._autoCheckpointOpTimer !== undefined ||
                (this._loadedOpCount - (this._loadedOpCountAtCheckpoint || 0) > this._autoCheckpointOpFreq)) {

                    // if either we were on the waiting period before firing an op freq auto checkpoint, or
                    // the threshold for creating one was just reached, (re) schedule it.

                    if (this._autoCheckpointOpTimer !== undefined) {
                        this.clearAutoCheckpointOpTimer()
                    }

                    this.setAutoCheckpointOpTimer();
            } else if (this._loadedOpCount - (this._loadedOpCountAtCheckpoint || 0) > 0) {

                // if not, but there are un-checkpointed ops, set the inactivity checkpoint timer

                this.setAutoCheckpointInactivityTimer();

            }
        } else {
            //console.log('no conditions for auto checkpointing ' + this.getLastHash() + ', sorry')
            //console.log(new Error().stack);
        }
    }

    private setAutoCheckpointOpTimer() {
        //console.log('Set auto checkpoint op timer for ' + this.getClassName() + ' ' + this.getLastHash() + ': ' + this._loadedOpCount + ' ops');
        const delay = this._autoCheckpointOpFreqDelay * (0.90 + Math.random() * 0.20) * 1000;
        this._autoCheckpointOpTimer = setTimeout(this._autoCheckpointCallback, delay);
    }

    private clearAutoCheckpointOpTimer() {
        if (this._autoCheckpointOpTimer !== undefined) {
            //console.log('Cleared auto checkpoint op timer for ' + this.getClassName() + ' ' + this.getLastHash() + ': ' + this._loadedOpCount + ' ops');
            clearTimeout(this._autoCheckpointOpTimer);
            this._autoCheckpointOpTimer = undefined;
        }
    }

    private setAutoCheckpointInactivityTimer()  {
        //console.log('Set auto checkpoint inactivity timer for ' + this.getClassName() + ' ' + this.getLastHash() + ': ' + this._loadedOpCount + ' ops');
        const delay = this._autoCheckpointInactivityDelay * (0.90 + Math.random() * 0.20) * 1000;
        this._autoCheckpointInactivityTimer = setTimeout(this._autoCheckpointCallback, delay);
    }

    private clearAutoCheckpointInactivityTimer() {
        if (this._autoCheckpointInactivityTimer !== undefined) {
            //console.log('Cleared auto checkpoint inactivity timer for ' + this.getClassName() + ' ' + this.getLastHash() + ': ' + this._loadedOpCount + ' ops');
            clearTimeout(this._autoCheckpointInactivityTimer);
            this._autoCheckpointInactivityTimer = undefined;
        }
    }

    createSyncAgent(peerGroupAgent: PeerGroupAgent) : StateSyncAgent {
        return new HeaderBasedSyncAgent(peerGroupAgent, this, this.getResources() as Resources, this._acceptedMutationOpClasses, this.getSyncAgentStateFilter());
        //return new TerminalOpsSyncAgent(peerGroupAgent, this.getLastHash(), this.getStore(), this._acceptedMutationOpClasses);
    }

    getSyncAgentId(peerGroupId: string) {
        return HeaderBasedSyncAgent.syncAgentIdFor(this.getLastHash(), peerGroupId);
    }

    getSyncAgentStateFilter() : StateFilter | undefined {
        return undefined;
    }

    async getSyncState(peerGroupId?: string): Promise<SyncState|undefined> {
        return this.getResources()?.mesh.getSyncState(this, peerGroupId);
    }

    addSyncObserver(obs: SyncObserver, peerGroupId?: string) {

        const mesh = this.getResources()?.mesh;

        if (mesh === undefined) {
            throw new Error('Trying to add a sync observer, but object ' + this.hash() + ' does not have a mesh resource.');
        }

        mesh.addSyncObserver(obs, this, peerGroupId);
    }

    removeSyncObserver(obs: SyncObserver, peerGroupId?: string) {

        const mesh = this.getResources()?.mesh;

        if (mesh === undefined) {
            throw new Error('Trying to add a sync observer, but object ' + this.hash() + ' does not have a mesh resource.');
        }

        mesh.removeSyncObserver(obs, this, peerGroupId);
    }

    getAcceptedMutationOpClasses() : Array<string> {
        return this._acceptedMutationOpClasses;
    }

    setResources(resources: Resources): void {

        if (this.getResources() === resources) return;

        let reBindToStore = false;

        if (this._boundToStore && resources.store !== this.getResources()?.store) {
            reBindToStore = true;
            this.unbindFromStore();
        }

        super.setResources(resources);

        if (reBindToStore) {
            this.bindToStore();
        }

        for (const aliases of this.getMutableContents().values()) {
            for (const obj of aliases) {
                obj.setResources(resources);
            }
        }

    }

    forgetResources(): void {

        if (this.isWatchingForChanges()) {
            this.dontWatchForChanges();
        }
        
        super.forgetResources();


        for (const aliases of this.getMutableContents().values()) {
            for (const obj of aliases) {
                obj.forgetResources();
            }
        }
    }

    static isCheckpointRestoreEvent(ev: MutationEvent) {
        return ev.action === CheckpointEvents.RestoredCheckpoint;
    }

    static isContentChangeEvent(ev: MutationEvent) {
        return ContentChangeEventActions.indexOf(ev.action) >= 0 || MutableObject.isCheckpointRestoreEvent(ev);
    }

    static isOpInvalidationEvent(ev: MutationEvent) {
        return OpInvaidationEventActions.indexOf(ev.action) >= 0 || MutableObject.isCheckpointRestoreEvent(ev);
    }

    isOwnEvent(ev: MutationEvent) {
        return ev.emitter === this
    }

    isOwnCheckpointRestoreEvent(ev: MutationEvent) {
        return this.isOwnEvent(ev) && MutableObject.isCheckpointRestoreEvent(ev);
    }

    isOwnContentChangeEvent(ev: MutationEvent) {
        return this.isOwnEvent(ev) && MutableObject.isContentChangeEvent(ev);
    }

    isOwnOpInvalidationEvent(ev: MutationEvent) {
        return this.isOwnEvent(ev) && MutableObject.isOpInvalidationEvent(ev);
    }

    enableAutoCheckpoints(autoCheckpointOpFreq?: number,autoCheckpointOpFreqDelay?: number, autoCheckpointInactivityDelay?: number) {
        this._autoCheckpoint = true;
        if (autoCheckpointOpFreq !== undefined) {
            this._autoCheckpointOpFreq = autoCheckpointOpFreq;
        }
        if (autoCheckpointOpFreqDelay !== undefined) {
            this._autoCheckpointOpFreqDelay = autoCheckpointOpFreqDelay
        }
        if (autoCheckpointInactivityDelay !== undefined) {
            this._autoCheckpointInactivityDelay = autoCheckpointInactivityDelay;
        }
    }

    disableAutoCheckpoints() {
        this._autoCheckpoint = false;   
    }
}

export { MutableObject, MutableContentEvents };
export type { MutableObjectConfig };
export type { StateCheckpoint };