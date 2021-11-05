import { Identity } from 'data/identity';
import { Hash, HashedObject, HashReference, MutationOp } from 'data/model';
import { CapabilitySet, GrantOp, RevokeAfterOp, UseOp } from 'data/containers';

//type PermissionTestOp = GrantOp|RevokeAfterOp|UseOp;

type PermissionUse = UseOp;

class PermissionTest extends CapabilitySet {

    static className = 'hhs-test/PermissionTest';

    constructor() {
        super();
    }

    getClassName(): string {
        return PermissionTest.className;
    }

    init(): void {
        
    }

    isRootOp(op: MutationOp): boolean { 
        const root = this.getAuthor();

        return root !== undefined && root.equals(op.getAuthor()) && (op.causalOps === undefined || op.causalOps.size() === 0);
    }

    isAdminOp(op: MutationOp, opReferences: Map<Hash, HashedObject>, admin?: Identity): boolean {

        const causalUseOps = op.causalOps;
        if (causalUseOps === undefined || causalUseOps.size() !== 1) {
            return false;
        }

        const causalUseOpRef = causalUseOps.values().next().value as MutationOp;

        if (!(causalUseOpRef instanceof HashReference)) {
            return false;
        }

        const causalUseOp = opReferences.get(causalUseOpRef.hash);

        if (causalUseOp === undefined || !(causalUseOp instanceof UseOp)) {
            return false;
        }

        const causalGrantOp = causalUseOp.grantOp as GrantOp;

        if (!this.isCapabilityUseForOp(op, causalUseOp)) {
            return false;
        }

        if (!(causalGrantOp instanceof GrantOp)) {
            return false;
        }

        if (!(causalGrantOp.grantee !== undefined  && causalGrantOp.grantee.equals(op.getAuthor()))) {
            return false;
        }

        if (causalGrantOp.capability !== 'admin') {
            return false;
        }

        if (admin !== undefined && !(admin.equals(op.getAuthor()))) {
            return false;
        }

        return true;
    }

    shouldAcceptMutationOp(op: MutationOp, opReferences: Map<Hash, HashedObject>): boolean {

        if (super.isAcceptedMutationOpClass(op)) {

            if (op instanceof GrantOp) {
                if (op.capability === 'admin' && this.isRootOp(op)) {
                    return true;
                } else if (op.capability === 'user' && (this.isRootOp(op) || this.isAdminOp(op, opReferences))) {
                    return true;
                } else {
                    return false;
                }
            } else if (op instanceof RevokeAfterOp) {
                if (op.getTargetOp().capability === 'admin' && this.isRootOp(op)) {
                    return true;
                } else if (op.getTargetOp().capability === 'user' && (this.isRootOp(op) || this.isAdminOp(op, opReferences))) {
                    return true;
                } else {
                    return false;
                }
            } else {
                return true
            }

    
        } else {
            return false;
        }


    }

    addAdmin(id: Identity): Promise<boolean> {
        let grantOp = this.findValidGrant(id, 'admin');

        if (grantOp === undefined) {
            grantOp = new GrantOp(this, id, 'admin');
            grantOp.setAuthor(this.getAuthor() as Identity);
            return this.applyNewOp(grantOp).then(() => true);
        } else {
            return Promise.resolve(false);
        }
    }

    removeAdmin(id: Identity): Promise<boolean> {

        const applies: Array<Promise<void>> = []

        for (const grantOp of this.findAllValidGrants(id, 'admin').values()) {
            const revokeOp = new RevokeAfterOp(grantOp, this._terminalOps.values());
            revokeOp.setAuthor(this.getAuthor() as Identity);
            applies.push(this.applyNewOp(revokeOp));
        }

        if (applies.length > 0) {
            return Promise.all<void>(applies).then((_value: void[]) => true);
        } else {
            return Promise.resolve(false);
        }
    }

    addUser(id: Identity, admin?: Identity): Promise<boolean> {
        const validGrantOp = this.findValidGrant(id, 'user');

        if (validGrantOp === undefined) {
            const grantOp = new GrantOp(this, id, 'user');
            if (admin === undefined) {
                
                grantOp.setAuthor(this.getAuthor() as Identity);
                return this.applyNewOp(grantOp).then(() => true);

            } else {

                grantOp.setAuthor(admin as Identity);
                grantOp.setPrevOps(this._terminalOps.values());
                const useAdminOp = this.useCapabilityForOp(admin, 'admin', grantOp);
                
                return this.applyNewOp(useAdminOp).then(() => this.applyNewOp(grantOp).then(() => true));
            }
            
        } else {
            return Promise.resolve(false);
        }
    }

    removeUser(id: Identity, admin?: Identity): Promise<boolean> {

        const applies: Array<Promise<void>> = [];

        const allValidGrants = this.findAllValidGrants(id, 'user');

        for (const grantOp of allValidGrants.values()) {

            const revokeOp = new RevokeAfterOp(grantOp, this._terminalOps.values());
            if (admin !== undefined) {
                revokeOp.setAuthor(this.getAuthor() as Identity);
                revokeOp.setPrevOps(this._terminalOps.values());
                const useAdminOp = this.useCapabilityForOp(admin, 'admin', revokeOp);
                applies.push(this.applyNewOp(useAdminOp));
            } else {
                revokeOp.setAuthor(this.getAuthor() as Identity);
            }
            
            applies.push(this.applyNewOp(revokeOp));
        }

        if (applies.length > 0) {
            return Promise.all<void>(applies).then((_value: void[]) => true);
        } else {
            return Promise.resolve(false);
        }
    }

    isUser(id: Identity): boolean {
        return this.findValidGrant(id, 'user') !== undefined;
    }
}

HashedObject.registerClass(PermissionTest.className, PermissionTest);

export { PermissionTest, PermissionUse };