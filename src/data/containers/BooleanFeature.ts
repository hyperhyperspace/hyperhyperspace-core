import { Hash } from '../model/Hashing';
import { HashedObject } from '../model/HashedObject';
import { HashReference } from '../model/HashReference';
import { MutableObject } from '../model/MutableObject';
import { MutationOp } from '../model/MutationOp';
import { InvalidateAfterOp } from '../model/InvalidateAfterOp';
import { Identity } from '../identity/Identity';

class EnableBooleanFeatureOp extends MutationOp {
    static className = 'hhs/v0/EnableBooleanFeatureOp';

    constructor(target?: BooleanFeature, causalOps?: IterableIterator<MutationOp>) {
        super(target);

        this.setRandomId();

        if (causalOps !== undefined) {
            this.setCausalOps(causalOps);
        }

    }
    
    init(): void {
        
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        return await super.validate(references) && this.getTargetObject() instanceof BooleanFeature;
    }

    getClassName(): string {
        return EnableBooleanFeatureOp.className;
    }
}

class DisableBooleanFeatureAfterOp extends InvalidateAfterOp {
    static className = 'hhs/v0/DisableBooleanFeatureAfterOp';

    constructor(targetOp?: EnableBooleanFeatureOp, terminalOps?: IterableIterator<MutationOp>, causalOps?: IterableIterator<MutationOp>) {
        super(targetOp, terminalOps);

        if (causalOps !== undefined) {
            this.setCausalOps(causalOps);
        }
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        return await super.validate(references) && this.getTargetOp() instanceof EnableBooleanFeatureOp;
    }

    getTargetOp(): EnableBooleanFeatureOp {
        return super.getTargetOp() as EnableBooleanFeatureOp;
    }

    getClassName(): string {
        return DisableBooleanFeatureAfterOp.className;
    }
}

class UseBooleanFeatureOp extends MutationOp {
    static className = 'hhs/v0/UseBooleanFeatureOp';

    enableOp?: EnableBooleanFeatureOp;
    usageKey?: Hash;

    constructor(enableOp?: EnableBooleanFeatureOp, usageKey?: Hash) {
        super(enableOp?.getTargetObject());

        if (enableOp !== undefined) {
            this.enableOp = enableOp;
            this.usageKey = usageKey;

            this.setCausalOps([enableOp].values());
        }
        
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {
        if (!await super.validate(references)) {
            return false;
        }

        const causalOps = this.causalOps;

        if (causalOps === undefined) {
            return false;
        }

        if (causalOps.size() !== 1) {
            return false;
        }

        const causalOpRef = causalOps.values().next().value as HashReference<MutationOp>;
        const causalOp = references.get(causalOpRef.hash);

        if (causalOp === undefined) {
             return false;
        }

        if (!(causalOp instanceof EnableBooleanFeatureOp)) {
            return false;
        }

        if (!(causalOp.getTargetObject().equals(this.getTargetObject()))) {
            return false;
        }

        if (this.enableOp === undefined || !(this.enableOp instanceof EnableBooleanFeatureOp)) {
            return false
        }

        if (!this.enableOp.equals(causalOp)) {
            return false;
        }

        return true;
        
    }

    init(): void {
        
    }

    getClassName(): string {
        return UseBooleanFeatureOp.className;
    }
}

class BooleanFeature extends MutableObject {
    static className = 'hhs/v0/BooleanFeature';
    static opClasses = [EnableBooleanFeatureOp.className, DisableBooleanFeatureAfterOp.className, UseBooleanFeatureOp.className];

    _validEnableOps: Map<Hash, EnableBooleanFeatureOp>;

    constructor() {
        super(BooleanFeature.opClasses, true);

        this._validEnableOps = new Map();
    }

    init(): void {
        
    }

    // return false iif the feature was already enabled
    enableFeaure(causalOps: Array<MutationOp>): boolean {
        
        if (!this.isEnabled()) {
            const enableOp = new EnableBooleanFeatureOp(this, causalOps.values());
            this.applyNewOp(enableOp);
            return true;
        } else {
            return false;
        }

    }

    // return false iif the feature was already disabled
    disableFeature(causalOps: Array<MutationOp>): boolean {

        let mutated = false;

        for (const validEnableOp of this._validEnableOps.values()) {
            const disableOp = new DisableBooleanFeatureAfterOp(validEnableOp, this._terminalOps.values(), causalOps.values());
            this.applyNewOp(disableOp);
            mutated = true;
        }

        return mutated;
    }

    useFeatureIfEnabled(usageKey: Hash, usingIdentity?: Identity): UseBooleanFeatureOp|undefined {
        
        const validEnableOp = this.findValidEnableOp();

        let useOp : UseBooleanFeatureOp|undefined = undefined;

        
        if (validEnableOp !== undefined) {
            const useOp = new UseBooleanFeatureOp(validEnableOp, usageKey);
            if (usingIdentity !== undefined) {
                useOp.setAuthor(usingIdentity);
            }
            this.applyNewOp(useOp);
            return useOp;
        } 

        return useOp;
    }

    useFeature(usageKey: Hash, usingIdentity?: Identity): UseBooleanFeatureOp {

        const useOp = this.useFeatureIfEnabled(usageKey, usingIdentity);

        if (useOp === undefined) {
            throw new Error('Trying to use BooleanFeature ' + this.hash() + ', but it is currently disabled.');
        }

        return useOp;
    }

    private findValidEnableOp(): EnableBooleanFeatureOp|undefined {

        for (const validEnableOp of this._validEnableOps.values()) {
            return validEnableOp;
        }

        return undefined;
    }

    mutate(op: MutationOp): Promise<boolean> {

        const wasEnabled = this.isEnabled();

        let opHash: Hash|undefined = undefined;

        if (op instanceof EnableBooleanFeatureOp) {
            opHash = op.hash();
        } else if (op instanceof InvalidateAfterOp) {
            opHash = op.targetOp?.hash() as Hash;
        }

        if (opHash !== undefined) {
            if (this.isValidOp(opHash)) {
                this._validEnableOps.set(opHash, op);
            } else {
                this._validEnableOps.delete(opHash);
            }
        }
        
        return Promise.resolve(wasEnabled === this.isEnabled());
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        references;

        // TODO: check that there are no superfluous fields to prevent malleability
        return true;
    }

    getClassName(): string {
        return BooleanFeature.className;
    }

    isEnabled(): boolean {
        return this._validEnableOps.size > 0;
    }
}

HashedObject.registerClass(EnableBooleanFeatureOp.className, EnableBooleanFeatureOp);
HashedObject.registerClass(DisableBooleanFeatureAfterOp.className, DisableBooleanFeatureAfterOp);
HashedObject.registerClass(UseBooleanFeatureOp.className, UseBooleanFeatureOp);
HashedObject.registerClass(BooleanFeature.className, BooleanFeature);

export { BooleanFeature, EnableBooleanFeatureOp, DisableBooleanFeatureAfterOp, UseBooleanFeatureOp };