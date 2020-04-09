import { HashedObject, LiteralContext } from './HashedObject';
import { MutationOp } from './MutationOp';
import { Hash } from './Hashing';
import { TerminalOpsSyncAgent } from 'data/sync/TerminalOpsSyncAgent';
import { HashReference } from './HashReference';
import { Store } from 'data/storage/Store';

type LoadStrategy = 'none'|'full'|'lazy';

abstract class MutableObject extends HashedObject {

    readonly _acceptedMutationOpClasses : Array<string>;
    readonly _loadStrategy              : LoadStrategy;

    _boundToStore  : boolean;
    _unsavedOps    : Array<MutationOp>;
    _prevOpsForUnsavedOps : Set<Hash>;

    _opCallback : (hash: Hash) => Promise<void>;


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
    }

    abstract async mutate(op: MutationOp): Promise<boolean>;

    bindToStore() {
        // NOTE: watchReferences is idempotent
        this.getStore().watchReferences('target', this.getLastHash(), this._opCallback);
        this._boundToStore = true;
    }

    unbindFromStore() {
        this.getStore().removeReferencesWatch('target', this.getLastHash(), this._opCallback);
        this._boundToStore = false;
    }

    // TODO: if this object is bound to the store while the load takes place, we could take measures
    //       to try to avoid loading objects twice if they arrive while the load takes place.
    //       As it is now, the implementation should prepare for the event of an op being loaded twice.

    async loadFromStore(limit?: number, start?: string) : Promise<void> {
        if (this._loadStrategy === 'none') {
            throw new Error("Trying to load operations from store, but load strategy was set to 'none'");
        } else if (this._loadStrategy === 'full') {

            if (limit !== undefined) {
                throw new Error("Trying to load " + limit + " operations from store, but load strategy was set to 'full' - you should use 'lazy' instead");
            }

            if (start !== undefined) {
                throw new Error("Trying to load operations from store starting at " + start + " but load strategy was set to 'full' - you should use 'lazy' instead");
            }

            await this.loadAllOpsFromStore();
        } else if (this._loadStrategy === 'lazy') {
            await this.loadLastOpsFromStore(limit, start);
        }

    }

    async loadAllOpsFromStore() {
        
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
                await this.apply(op);
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

    async loadLastOpsFromStore(limit?: number, start?: string) {

        let lastOp: Hash | undefined = undefined;

        let params: any = { order: 'desc', limit: limit };
        
        if (start !== undefined) { params.start = start };

        let results = await this.getStore()
                                .loadByReference(
                                    'target', 
                                    this.getLastHash(), 
                                    params);
        
        for (const obj of results.objects) {
            let op = obj as MutationOp;

            if (lastOp !== undefined) {
                if (lastOp === op.getLastHash()) {
                    lastOp === undefined;
                }
            }

            if (lastOp === undefined && this.shouldAcceptMutationOp(op)) {
                this.apply(op);
            }
        }

    }


    async applyOpFromStore(hash: Hash) : Promise<void> {
        let op: MutationOp;

        op = await this.getStore().load(hash, this.getAliasingContext()) as MutationOp;
        
        await this.apply(op);
    }

    async applyNewOp(op: MutationOp) : Promise<void> {

        if (!this.shouldAcceptMutationOp(op)) {
            throw new Error ('Invalid op ' + op.hash() + ' attempted for ' + this.hash());
        } else {

            op.setTarget(this);

            let prevOps = op.getPrevOps();

            let terminalOps = new Set<Hash>();

            if (prevOps === undefined) {

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
                            terminalOps.add(opHash);
                        }    
                    }    
                }

                for (const opHash of this._prevOpsForUnsavedOps) {
                    terminalOps.delete(opHash);
                }

                let terminalOpRefs = new Set<HashReference>();

                for (const opHash of terminalOps) {
                    let terminalOp = await this.getStore().load(opHash, this.getAliasingContext()) as MutationOp;
                    terminalOpRefs.add(terminalOp.createReference());
                }

                if (this._unsavedOps.length > 0) {
                    let last = this._unsavedOps[this._unsavedOps.length - 1];
                    terminalOpRefs.add(last.createReference());
                }
                
                op.setPrevOps(terminalOpRefs.values());
            }            

            await this.apply(op);

            for (let opHash of terminalOps) {
                this._prevOpsForUnsavedOps.add(opHash);
            }

            this.enqueueOpToSave(op);
        }
    }

    protected async apply(op: MutationOp) : Promise<void> {
        await this.mutate(op);
    }


    async saveQueuedOps(store?: Store) : Promise<boolean> {

        if (store === undefined) {
            store = this.getStore();
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
                    throw e;
                }
                
                let prevOps = op.getPrevOps();
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

    literalizeInContext(context: LiteralContext, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('mutable');

        return super.literalizeInContext(context, path, flags);

    }

    shouldAcceptMutationOp(op: MutationOp) {
        return this._acceptedMutationOpClasses.indexOf(op.getClassName()) >= 0;
    }

    getSyncAgent() {
        return new TerminalOpsSyncAgent(this.getLastHash(), this.getStore(), this._acceptedMutationOpClasses);
    }

}

export { MutableObject }