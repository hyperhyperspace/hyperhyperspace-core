import { Hash } from '../model/Hashing';
import { HashedObject } from '../model/HashedObject';
import { HashedSet } from '../model/HashedSet';
import { MutableObject } from '../model/MutableObject';
import { MutationOp } from '../model/MutationOp';
import { InvalidateAfterOp } from '../model/InvalidateAfterOp';

import { Identity } from '../identity/Identity';

import { MultiMap } from 'util/multimap';


type FeatureName = string;

class EnableFeatureOp extends MutationOp {
    static className = 'hhs/v0/EnableFeatureOp';

    featureName?: FeatureName;

    constructor(target?: AbstractFeatureSet, featureName?: FeatureName) {
        super(target);

        if (featureName !== undefined) {
            this.featureName = featureName;
        }

    }
    
    init(): void {
        
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        

        if (!(await super.validate(references))) {
            console.log(1)
            return false;
        }

        const target = this.getTargetObject();

        if (!(target instanceof AbstractFeatureSet)) {
            console.log(2)
            return false;
        }

        if (this.featureName === undefined || !target.getFeatureNames().has(this.featureName)) {
            console.log(3)
            return false;
        }

        if (this.hasCausalOps() && this.hasId()) {
            console.log(4)
            return false;
        }

        /*
        if (this.getCausalOps()?.size() !== 1) {
            return false;
        }

        const causalOpRef = this.getCausalOps().values().next().value as HashReference<MutationOp>;
        const causalOp = references.get(causalOpRef.hash);

        if (!(causalOp instanceof UseOp)) {
            return false;
        }

        if (this.getUsageKey() !== causalOp )
        */
        
        return true;
    }

    getClassName(): string {
        return EnableFeatureOp.className;
    }
}

class DisableFeatureAfterOp extends InvalidateAfterOp {
    static className = 'hhs/v0/DisableFeatureAfterOp';

    constructor(targetOp?: EnableFeatureOp, terminalOps?: IterableIterator<MutationOp>) {
        super(targetOp, terminalOps);
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {

        if (!await super.validate(references)) {
            return false;
        }

        if (!(this.getTargetOp() instanceof EnableFeatureOp)) {
            return false
        }

        if (!this.getTargetOp().getTargetObject()?.equals(this.getTargetObject())) {
            return false;
        }

        if (this.hasCausalOps() && this.hasId()) {
            return false;
        }

        return true;
    }

    getTargetOp(): EnableFeatureOp {
        return super.getTargetOp() as EnableFeatureOp;
    }

    getClassName(): string {
        return DisableFeatureAfterOp.className;
    }
}

class UseFeatureOp extends MutationOp {
    static className = 'hhs/v0/UseFeatureOp';

    enableOp?: EnableFeatureOp;
    usageKey?: Hash;

    constructor(enableOp?: EnableFeatureOp, usageKey?: Hash) {
        super(enableOp?.getTargetObject());

        if (enableOp !== undefined) {
            this.enableOp = enableOp;
            this.usageKey = usageKey;

            this.setCausalOps([enableOp].values())
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

        const causalOp = causalOps.values().next().value as MutationOp;

        if (causalOp === undefined) {
             return false;
        }

        if (!(causalOp instanceof EnableFeatureOp)) {
            return false;
        }

        if (!(causalOp.getTargetObject().equals(this.getTargetObject()))) {
            return false;
        }

        if (this.enableOp === undefined || !(this.enableOp instanceof EnableFeatureOp)) {
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
        return UseFeatureOp.className;
    }
}

abstract class AbstractFeatureSet extends MutableObject {

    static opClasses = [EnableFeatureOp.className, DisableFeatureAfterOp.className, UseFeatureOp.className];

    featureNames?: HashedSet<string>;

    _allValidEnableOps: Map<Hash, EnableFeatureOp>;
    _validEnableOpsPerFeature: MultiMap<FeatureName, Hash>;

    constructor(featureNames?: IterableIterator<string>) {
        super(AbstractFeatureSet.opClasses, true);

        if (featureNames !== undefined) {
            this.featureNames = new HashedSet(featureNames);
        }

        this._allValidEnableOps = new Map();
        this._validEnableOpsPerFeature = new MultiMap();
    }

    init(): void {
        
    }



    useFeatureIfEnabled(featureName: FeatureName, usageKey: Hash, usingIdentity?: Identity): UseFeatureOp|undefined {
        
        const validEnableOp = this.findValidEnableOp(featureName);

        let useOp : UseFeatureOp|undefined = undefined;

        
        if (validEnableOp !== undefined) {
            const useOp = new UseFeatureOp(validEnableOp, usageKey);
            if (usingIdentity !== undefined) {
                useOp.setAuthor(usingIdentity);
            }
            this.applyNewOp(useOp);
            return useOp;
        } 

        return useOp;
    }

    useFeature(featureName: FeatureName, usageKey: Hash, usingIdentity?: Identity): UseFeatureOp {

        const useOp = this.useFeatureIfEnabled(featureName, usageKey, usingIdentity);

        if (useOp === undefined) {
            throw new Error('Trying to use BooleanFeature ' + this.hash() + ', but it is currently disabled.');
        }

        return useOp;
    }

    private findValidEnableOp(featureName: FeatureName): EnableFeatureOp|undefined {

        for (const validEnableOpHash of this._validEnableOpsPerFeature.get(featureName).values()) {
            return this._allValidEnableOps.get(validEnableOpHash);
        }

        return undefined;
    }

    mutate(op: MutationOp): Promise<boolean> {
        
        let mutated = false;
        
        let enableOp: EnableFeatureOp|undefined;
        let featureName: FeatureName|undefined;

        if (op instanceof EnableFeatureOp) {
            enableOp = op;
            featureName = op.featureName;
        } else if (op instanceof DisableFeatureAfterOp) {
            enableOp = op.targetOp as EnableFeatureOp;
            featureName = (op.targetOp as EnableFeatureOp).featureName as string;
        }

        if (enableOp !== undefined && featureName !== undefined) {
            const enableOpHash = enableOp.hash();
            const wasEnabled = this.isEnabled(featureName)

            if (this.isValidOp(enableOpHash)) {
                this._allValidEnableOps.set(enableOpHash, enableOp);
                this._validEnableOpsPerFeature.add(featureName, enableOpHash);
            } else {
                this._allValidEnableOps.delete(enableOpHash);
                this._validEnableOpsPerFeature.delete(featureName, enableOpHash);
            }

            mutated = wasEnabled === this.isEnabled(featureName);
        }

        return Promise.resolve(mutated);
    }
    
    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        
        references;

        if (this.featureNames === undefined) {
            return false;
        }

        if (!(this.featureNames instanceof HashedSet)) {
            return false;
        }

        for (const featureName of this.featureNames.values()) {
            if (typeof(featureName) !== 'string') {
                return false;
            }
        }
        
        // TODO: check that there are no superfluous fields to prevent malleability

        return true;
    }

    getFeatureNames() {
        if (this.featureNames === undefined) {
            throw new Error('FeatureSet ' + this.hash() + ' is missing its set of feature names.');
        }

        return this.featureNames;
    }

    isEnabled(feature: FeatureName) {
        const featureEnableOps = this._validEnableOpsPerFeature.get(feature);

        return featureEnableOps !== undefined && featureEnableOps.size > 0;
    }
}

HashedObject.registerClass(EnableFeatureOp.className, EnableFeatureOp);
HashedObject.registerClass(DisableFeatureAfterOp.className, DisableFeatureAfterOp);
HashedObject.registerClass(UseFeatureOp.className, UseFeatureOp);

export { AbstractFeatureSet, FeatureName, EnableFeatureOp, DisableFeatureAfterOp, UseFeatureOp };