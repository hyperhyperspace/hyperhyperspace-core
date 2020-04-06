import { HashedObject, LiteralContext } from './HashedObject';
import { MutationOp } from './MutationOp';
import { Hash } from './Hashing';
import { TerminalOpsSyncAgent } from 'data/sync/TerminalOpsSyncAgent';

abstract class MutableObject extends HashedObject {

    _acceptedMutationOpClasses : Array<string>;

    _unsavedOps : Array<MutationOp>;

    _opCallback : (hash: Hash) => void;


    constructor(acceptedOpClasses : Array<string>) {
        super();
        
        this._acceptedMutationOpClasses = acceptedOpClasses;

        this._unsavedOps = [];

        this._opCallback = (hash: Hash) => {
            this.applyOpFromStore(hash);
        };
    }

    abstract async mutate(op: MutationOp): Promise<boolean>;

    async applyOpFromStore(hash: Hash) {
        let op: MutationOp;

        op = await this.getStore().load(hash, this.getAliasingContext()) as MutationOp;
        
        await this.mutate(op);
    }

    async applyNewOp(op: MutationOp) : Promise<void> {

        if (this.shouldAcceptMutationOp(op)) {
            throw new Error ('Invalid op ' + op.hash() + 'attempted for ' + this.hash());
        } else {
            await this.mutate(op);
            this.enqueueOpToSave(op);
        }
    }

    nextOpToSave() : MutationOp | undefined {
        if (this._unsavedOps.length > 0) {
            return this._unsavedOps.shift();
        } else {
            return undefined;
        }
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

    shouldAcceptMutationOp(op: MutationOp) {
        return this._acceptedMutationOpClasses.indexOf(op.getClassName()) >= 0;
    }

    getSyncAgent() {
        return new TerminalOpsSyncAgent(this.getStoredHash(), this.getStore(), this._acceptedMutationOpClasses);
    }

}

export { MutableObject }