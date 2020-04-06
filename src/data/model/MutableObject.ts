import { HashedObject, LiteralContext } from './HashedObject';
import { MutationOp } from './MutationOp';
import { Hash } from './Hashing';

type StateCallback = (mutable: Hash) => void;

abstract class MutableObject extends HashedObject {

    _unsavedOps : Array<MutationOp>;

    _lastReportedState?: HashedObject;
    _stateCallbacks: Set<StateCallback>;

    _opCallback : (hash: Hash) => void;


    constructor() {
        super();
        
        this._unsavedOps = [];

        this._lastReportedState = undefined;
        this._stateCallbacks    = new Set();

        this._opCallback = (hash: Hash) => {
            this.applyOpFromStore(hash);
        };
    }

    abstract async loadState() : Promise<void>;
    abstract currentState(): HashedObject;
    abstract async validate(op: MutationOp): Promise<boolean>;
    abstract async mutate(op: MutationOp): Promise<boolean>;

    async applyOpFromStore(hash: Hash) {
        let op: MutationOp;

        op = await this.getStore().load(hash, this.getAliasingContext()) as MutationOp;
        
        await this.applyOp(op);
    }

    async applyNewOp(op: MutationOp) : Promise<void> {

        if (!this.validate(op)) {
            throw new Error ('Invalid op ' + op.hash() + 'attempted for ' + this.hash());
        } else {
            await this.applyOp(op);
            this.enqueueOpToSave(op);
        }
    }

    private async applyOp(op: MutationOp) {
       
        let mutated = await this.mutate(op);

        if (mutated) {

            let newState = this.currentState();

            if (  this._lastReportedState === undefined ||
                  !this._lastReportedState.equals(newState)) {
    
                for (const callback of this._stateCallbacks) {
                    callback(this.getStoredHash());
                }
    
            }
    
        }

    }

    nextOpToSave() : MutationOp | undefined {
        if (this._unsavedOps.length > 0) {
            return this._unsavedOps.shift();
        } else {
            return undefined;
        }
    }

    informSavedOp(_op: MutationOp) {

    }

    failedToSaveOp(op: MutationOp) : void {
        this._unsavedOps.unshift(op);
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

    autoLoadFromStore(value: boolean) {
        if (value) {
            this.getStore().watchReferences('target', this.getStoredHash(), this._opCallback);
        } else {
            this.getStore().removeReferencesWatch('target', this.getStoredHash(), this._opCallback);
        }
    }

    publishNewState() {

    }

    watchState(callback: StateCallback) : void {
        this._stateCallbacks.add(callback);
    }

    removeStateWatch(callback: StateCallback) : boolean {
        return this._stateCallbacks.delete(callback);
    }

}

export { MutableObject, StateCallback }