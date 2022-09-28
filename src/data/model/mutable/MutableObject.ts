import { Store } from 'storage/store';

import { HashedObject } from '../immutable/HashedObject';
import { Context } from '../literals/Context';
import { Hash } from '../hashing/Hashing';
import { Logger, LogLevel } from 'util/logging';
import { HeaderBasedSyncAgent, StateSyncAgent, StateFilter } from 'mesh/agents/state';
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

type MutableObjectConfig = {supportsUndo?: boolean};

abstract class  MutableObject extends HashedObject {

    static controlLog = new Logger(MutableObject.name, LogLevel.INFO)
    static prevOpsComputationLog = new Logger(MutableObject.name, LogLevel.INFO);

    readonly _acceptedMutationOpClasses : Array<string>;
    
    _allAppliedOps : Set<Hash>;
    _terminalOps   : Map<Hash, MutationOp>;
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
        return this._activeCascInvsPerOp.get(opHash).size === 0;
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

    async loadAllChanges(batchSize=128) {

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
                                    });
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

        const opHash = op.hash();

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
            
            let targetOp: MutationOp|undefined;
            let targetOpHash: Hash|undefined;

            const finalTargetOp     = op.getFinalTargetOp();
            const finalTargetOpHash = finalTargetOp.hash();
            
            const wasValid = this.isValidOp(finalTargetOpHash);

            let currentOp: CascadedInvalidateOp|undefined = op;
            let currentOpHash: Hash|undefined = currentOp.hash();
            let flipped: boolean;

            do {
                targetOp = currentOp.getTargetOp();
                targetOpHash = targetOp?.hash();

                const wasValid = this.isValidOp(targetOpHash);
                if (this.isValidOp(currentOpHash)) {
                    this._activeCascInvsPerOp.add(targetOpHash, currentOpHash);
                } else {
                    this._activeCascInvsPerOp.delete(targetOpHash, currentOpHash);
                }
                const isValid  = this.isValidOp(targetOpHash);
                
                flipped = wasValid !== isValid;
                
                if (flipped && targetOp instanceof CascadedInvalidateOp) {
                    currentOp = targetOp;
                    currentOpHash = targetOpHash;
                } else {
                    currentOp = undefined;
                    currentOpHash = undefined;
                }

            } while (currentOp !== undefined && currentOpHash !== undefined);

            if (wasValid !== this.isValidOp(finalTargetOpHash) ) {
                if (op.undo) {
                    result = this.mutate(op.getFinalTargetOp(), false, true);
                } else {
                    result = this.mutate(op.getFinalTargetOp(), true, true);
                }
            }
            
            /*
            
            const finalTargetOp     = op.getFinalTargetOp();
            const finalTargetOpHash = finalTargetOp.hash();
            
            const wasUndone = this._activeCascInvsPerOp.get(finalTargetOpHash).size > 0;

            if (op.undo) {
                this._activeCascInvsPerOp.add(finalTargetOpHash, opHash);
            } else { // redo
                this._activeCascInvsPerOp.delete(finalTargetOpHash, op.getTargetOp().hash());
            }

            if (wasUndone !== op.undo) {
                if (op.undo) {
                    //result = this.undo(op.getFinalTargetOp());
                    result = this.mutate(op.getFinalTargetOp(), false, true);
                } else { // redo
                    //result = this.redo(op.getFinalTargetOp());
                    result = this.mutate(op.getFinalTargetOp(), true, true);
                }
            }
            */
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

    protected setCurrentPrevOps(op: MutationOp): void {

        op.setPrevOps(this._terminalOps.values());
    }

    protected enqueueOpToSave(op: MutationOp) : void {
        this._unsavedOps.push(op);
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

    protected createMutationEventSource(seen=new Set<HashedObject>()): EventRelay<HashedObject> {

        const ownMutationEventSource = super.createMutationEventSource(seen);

        this.updateCascadeMutableContentRelays(ownMutationEventSource, seen);

        return ownMutationEventSource;

    }

    private updateCascadeMutableContentRelays(ownMutationEventSource?: EventRelay<HashedObject>, seen=new Set<HashedObject>()) {

        if (ownMutationEventSource !== undefined) {

            if (this.isCascadingMutableContentEvents()) {
                ownMutationEventSource.addObserver(this._cascadeMutableContentObserver);

                this.addEventRelaysForContents(ownMutationEventSource, seen);
            } else {
                ownMutationEventSource.removeObserver(this._cascadeMutableContentObserver);

                this.removeEventRelaysForContents(ownMutationEventSource, seen);
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
                        MutableObject.addEventRelayForElmt(own, hash, elmt);
                    }
                }
            }    
        }
    }

    createSyncAgent(peerGroupAgent: PeerGroupAgent) : StateSyncAgent {
        return new HeaderBasedSyncAgent(peerGroupAgent, this, this.getResources() as Resources, this._acceptedMutationOpClasses, this.getSyncAgentStateFilter());
        //return new TerminalOpsSyncAgent(peerGroupAgent, this.getLastHash(), this.getStore(), this._acceptedMutationOpClasses);
    }

    getSyncAgentStateFilter() : StateFilter | undefined {
        return undefined;
    }

    getAcceptedMutationOpClasses() : Array<string> {
        return this._acceptedMutationOpClasses;
    }

    setResources(resources: Resources, seen = new Set<HashedObject>()): void {
        if (seen.has(this)) return;
        
        seen.add(this);

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
                obj.setResources(resources, seen);
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