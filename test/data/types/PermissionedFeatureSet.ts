import { FeatureName, FeatureSet, DisableFeatureAfterOp, EnableFeatureOp, UseFeatureOp, UseCapabilityOp } from 'data/containers';
import { Hash, HashedObject, MutationOp } from 'data/model';
import { Identity } from 'data/identity';
import { PermissionTest } from './PermissionTest';


class PermissionedFeatureSet extends FeatureSet {
    static className = 'hhs-test/PermissionedFeatureSet';

    static adminFeatures = new Set(['anon-write', 'anon-read']);

    users?: PermissionTest;

    constructor(users?: PermissionTest) {
        super(PermissionedFeatureSet.adminFeatures.values());

        if (users !== undefined) {
            this.users = users;
        }
    }

    async enableFeature(featureName: FeatureName, admin: Identity): Promise<boolean> {
    
        if (!this.isEnabled(featureName)) {
            const enableOp = new EnableFeatureOp(this, featureName);
            enableOp.setAuthor(admin);
            enableOp.setPrevOps(this._terminalOps.values());
            const useOp = this.users?.useCapabilityForOpIfAvailable(admin, 'admin', enableOp);
            if (useOp !== undefined) {
                const applyUseOp = this.getUsers().applyNewOp(useOp);
                const applyEnableOp = this.applyNewOp(enableOp);
                return applyUseOp.then(() => applyEnableOp).then(() => true);
            } else {
                return false;
            }
        } else {
            return true;
        }

    }

    async disableFeature(featureName: FeatureName, admin: Identity): Promise<boolean> {

        for (const validEnableOpHash of this._validEnableOpsPerFeature.get(featureName).values()) {
            const validEnableOp = this._allValidEnableOps.get(validEnableOpHash);
            const disableOp = new DisableFeatureAfterOp(validEnableOp, this._terminalOps.values());
            disableOp.setAuthor(admin);
            disableOp.setPrevOps(this._terminalOps.values());
            const useOp = this.getUsers().useCapabilityForOpIfAvailable(admin, 'admin', disableOp);
            if (useOp !== undefined) {
                const applyUseOp = this.getUsers().applyNewOp(useOp);
                const applyDisableOp =  this.applyNewOp(disableOp);
                return applyUseOp.then(() => applyDisableOp).then(() => true);
            } else {
                return false;
            }
        }

        return true;
    }

    private isValidFeatureSetOp(op: EnableFeatureOp|DisableFeatureAfterOp): boolean {
        
        const causalUseOps = op.causalOps;
        if (causalUseOps === undefined || causalUseOps.size() !== 1) {
            console.log('*')
            return false;
        }

        const causalUseOp = causalUseOps.values().next().value as UseCapabilityOp;

        if (!(causalUseOp instanceof UseCapabilityOp)) {
            console.log('?')
            return false;
        }

        if (!this.users?.checkCapabilityForOp(causalUseOp, 'admin', op, op.getAuthor())) {
            console.log('%')
            return false;
        }

        if ((op instanceof EnableFeatureOp) && (op.featureName === undefined || !PermissionedFeatureSet.adminFeatures.has(op.featureName))) {
            console.log('@')
            return false;
        }

        if ((op instanceof DisableFeatureAfterOp) && (op.getTargetOp().featureName === undefined || !PermissionedFeatureSet.adminFeatures.has(op.getTargetOp().featureName as string))) {
            console.log('!')
            return false;
        }

        return true;
    }

    shouldAcceptMutationOp(op: MutationOp, opReferences: Map<Hash, HashedObject>): boolean {

        opReferences;

        if (super.isAcceptedMutationOpClass(op)) {
            if (op instanceof EnableFeatureOp || op instanceof DisableFeatureAfterOp) {
                return this.isValidFeatureSetOp(op);
            } else if (op instanceof UseFeatureOp) {
                return true;
            } else {
                return true;
            }
        } else {
            return false;
        }
    }

    getUsers(): PermissionTest {
        if (this.users === undefined) {
            throw new Error('this.users is missing for ' + this.hash());
        } else {
            return this.users;
        }
    }

    getClassName() {
        return PermissionedFeatureSet.className;
    }

}

HashedObject.registerClass(PermissionedFeatureSet.className, PermissionedFeatureSet);

export { PermissionedFeatureSet };