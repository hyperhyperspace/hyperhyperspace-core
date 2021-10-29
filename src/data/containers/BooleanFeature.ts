import { Hash } from '../model/Hashing';
import { HashedObject } from '../model/HashedObject';
import { HashReference } from '../model/HashReference';
import { MutableObject } from '../model/MutableObject';
import { MutationOp } from '../model/MutationOp';
import { InvalidateAfterOp } from '../model/InvalidateAfterOp';

class EnableBooleanFeatureOp extends MutationOp {
    static className = 'hhs/v0/EnableBooleanFeatureOp';

    constructor(target?: BooleanFeature, causalOps?: IterableIterator<MutationOp>) {
        super(target, causalOps);
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
        super(targetOp, terminalOps, causalOps);
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
        super(enableOp?.getTargetObject(), enableOp === undefined? undefined : [enableOp].values());

        if (enableOp !== undefined) {
            this.enableOp = enableOp;
            this.usageKey = usageKey;
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

    constructor() {
        super(BooleanFeature.opClasses, true);
    }

    init(): void {
        throw new Error('Method not implemented.');
    }

    mutate(op: MutationOp): Promise<boolean> {
        throw new Error('Method not implemented.');
    }

    validate(references: Map<string, HashedObject>): Promise<boolean> {
        throw new Error('Method not implemented.');
    }

    getClassName(): string {
        return BooleanFeature.className;
    }

}

HashedObject.registerClass(EnableBooleanFeatureOp.className, EnableBooleanFeatureOp);
HashedObject.registerClass(DisableBooleanFeatureAfterOp.className, DisableBooleanFeatureAfterOp);
HashedObject.registerClass(UseBooleanFeatureOp.className, UseBooleanFeatureOp);
HashedObject.registerClass(BooleanFeature.className, BooleanFeature);

export { BooleanFeature as BooleanFeature };