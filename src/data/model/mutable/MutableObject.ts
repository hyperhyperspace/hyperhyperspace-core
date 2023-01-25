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
import { MutationEvent } from 'data/model';

//import { ObjectStateAgent } from 'sync/agents/state/ObjectStateAgent';
//import { TerminalOpsStateAgent } from 'sync/agents/state/TerminalOpsStateAgent';

enum MutableContentEvents {
    AddObject    = 'add-object',
    RemoveObject = 'remove-object'
};

const ContentChangeEventActions: Array<string> = [MutableContentEvents.AddObject, MutableContentEvents.RemoveObject];

type MutableObjectConfig = {supportsUndo?: boolean, supportsCheckpoints?: boolean, checkpointFreq?: number};

type StateCheckpoint = {
    mutableObject: Hash,
    terminalOpHashes: Array<Hash>,
    allAppliedOps: Array<Hash>,
    activeCascInvsPerOp: Array<[Hash, Array<Hash>]>, 
    exportedState: any
};

abstract class MutableObject extends HashedObject {

    static controlLog = new Logger(MutableObject.name, LogLevel.INFO)
    static prevOpsComputationLog = new Logger(MutableObject.name, LogLevel.INFO);

    readonly _acceptedMutationOpClasses : Array<string>;
    readonly _supportsCheckpoints: boolean;

    _allAppliedOps : Set<Hash>;
    _terminalOps   : Map<Hash, MutationOp>;

    // We only keep track of inv. for the op at the very end of
    // an undo / redo chain (e.g. for each causal dep an op has,
    // only an undo op at the very end of the chain can be in
    // _activeCascInvsPerOp).
    _activeCascInvsPerOp       : MultiMap<Hash, Hash>;


    _unsavedOps      : Array<MutationOp>;
    _unappliedOps    : Map<Hash, MutationOp>;

    _applyOpsLock : Lock;

    _opCallback : (hash: Hash) => Promise<void>;

    // If anyone using this mutable object needs to be notified whenever it changes,
    // an external mutation callback should be registered below.
    _externalMutationCallbacks : Set<(mut: MutationOp) => void>;

    _cascadeMutableContentObserver : Observer<HashedObject>;

    constructor(acceptedOpClasses : Array<string>, config?: MutableObjectConfig) {
        super();

        if (config?.supportsUndo || false) {
            if (acceptedOpClasses.indexOf(CascadedInvalidateOp.className) < 0) {
                acceptedOpClasses.push(CascadedInvalidateOp.className);
            }
        }

        this._supportsCheckpoints = config?.supportsCheckpoints || false;
        
        this._acceptedMutationOpClasses = acceptedOpClasses;
        this._boundToStore = false;

        this._allAppliedOps = new Set();
        this._terminalOps   = new Map();
        this._activeCascInvsPerOp  = new MultiMap();

        this._unsavedOps      = [];
        this._unappliedOps    = new Map();
        
        this._applyOpsLock = new Lock();

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
                    }
                }

            }

        }
    }

    supportsUndo() {
        return this._acceptedMutationOpClasses.indexOf(CascadedInvalidateOp.className) >= 0
    }

    abstract mutate(op: MutationOp, valid: boolean, cascade: boolean): Promise<boolean>;
    abstract getMutableContents(): MultiMap<Hash, HashedObject>;
    abstract getMutableContentByHash(hash: Hash): Set<HashedObject>;

    // override the following two to support checkpointing (and pass apropriate params in config to constructor)

    exportMutableState(): any {
        throw new Error(this.getClassName() + ': this class does not support state packing')
    }

    importMutableState(state: any) {
        state;
        throw new Error(this.getClassName() + ': this class does not support applying packed state')
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

    async loadAllChanges(batchSize=128, context = new Context()) {

        await super.loadAllChanges(batchSize, context);

        if (this._supportsCheckpoints) {
            try {
                const checkpoint = await this.getStore().loadLastCheckpoint(this.getLastHash());

                if (checkpoint !== undefined) {
                    this.restoreCheckpoint(checkpoint);
    
                    // TODO: find a way to get the correct "start" parameter for loadByReference below
                    //       to make it ignore all the ops in the checkpoint
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
                                        limit: batchSize
                                    },
                                    context);

        while (results.objects.length > 0) {

            for (const obj of results.objects) {
                if (obj instanceof MutationOp && this.isAcceptedMutationOpClass(obj)) {
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
                                    },
                                    context);
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

            const done = this.apply(op, true);
            
            return done;                
        }
    }

    protected apply(op: MutationOp, isNew: boolean) : Promise<void> {

        if (isNew) {
            op.hash();
        }

        const opHash = op.getLastHash();

        if (this._allAppliedOps.has(opHash)) {
            return Promise.resolve();
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

        if (op instanceof CascadedInvalidateOp) {

            const finalTargetOp     = op.getFinalTargetOp();
            const finalTargetOpHash = finalTargetOp.hash();
            
            const wasValid = this.isValidOp(finalTargetOpHash);

            if (op.undo) {
                this._activeCascInvsPerOp.add(finalTargetOpHash, opHash);
            } else {
                this._activeCascInvsPerOp.delete(finalTargetOpHash, op.getTargetOp().hash());
            }

            const isValidNow = this.isValidOp(finalTargetOpHash);
            const isCascade  = op.targetOp instanceof CascadedInvalidateOp;

            if (wasValid !==  isValidNow) {
                result = this.mutate(finalTargetOp, isValidNow, isCascade);
            }
        } else {
            result = this.mutate(op, true, false);
        }

        const done = result.then((mutated: boolean) => {
            if (mutated) {
                for (const cb of this._externalMutationCallbacks) {
                    cb(op);
                }
            }        
        });

        return done;
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
            if (this.getResources() === undefined) {
                this.setStore(store);
            }
        }

        if (this._unsavedOps.length === 0) {
            return false;
        } else {
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
            allAppliedOps: Array.from(this._allAppliedOps), 
            activeCascInvsPerOp: Array.from(this._activeCascInvsPerOp.entries()).map((v: [Hash, Set<Hash>]) => [v[0], Array.from(v[1].values())]),
            exportedState: this.exportMutableState()
        };
    }

    async saveCheckpoint() : Promise<StateCheckpoint> {

        await this.saveQueuedOps();
        const check = this.createCheckpoint();
        await this.getStore().saveCheckpoint(check);
        return check;
    }

    async restoreCheckpoint(checkpoint: StateCheckpoint) {
        if (this.getLastHash() !== checkpoint.mutableObject) {
            throw new Error('Trying to apply a state checkpoint to ' + this.getLastHash() + ', but the checkpoint is for ' + checkpoint.mutableObject);
        }

        const terminalOps = new Map<Hash, MutationOp>();

        for (const opHash of checkpoint.terminalOpHashes.values()) {
            const op = await this.loadOp(opHash);

            if (op === undefined) {
                throw new Error('Cannot apply checkpoint to ' + this.getLastHash() + ', missing op: ' + opHash);
            }

            terminalOps.set(opHash, op);
        }

        this._terminalOps = terminalOps;
        this._allAppliedOps = new Set(checkpoint.allAppliedOps.values());
        this._activeCascInvsPerOp = new MultiMap();

        for (const [k, vs] of checkpoint.activeCascInvsPerOp) {
            for (const v of vs) {
                this._activeCascInvsPerOp.add(k, v);
            }
        }

        this.importMutableState(checkpoint.exportedState);
    }


    literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('mutable');

        if (this.supportsUndo()) {
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

    isOwnEvent(ev: MutationEvent) {
        return ev.emitter === this
    }

    isOwnContentChangeEvent(ev: MutationEvent) {
        return this.isOwnEvent(ev) && MutableObject.isContentChangeEvent(ev);
    }

    static isContentChangeEvent(ev: MutationEvent) {
        return ContentChangeEventActions.indexOf(ev.action) >= 0;
    }
}

export { MutableObject, MutableContentEvents };
export type { MutableObjectConfig };
export type { StateCheckpoint };