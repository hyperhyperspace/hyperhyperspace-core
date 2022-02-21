import { Identity } from 'data/identity';
import { Hash, HashedObject, MutationOp } from 'data/model';
import { AbstractCapabilitySet, GrantCapabilityOp, RevokeCapabilityAfterOp, UseCapabilityOp } from './AbstractCapabilitySet';

//type PermissionTestOp = GrantOp|RevokeAfterOp|UseOp;

type PermissionUse = UseCapabilityOp;

class PermissionTest extends AbstractCapabilitySet {

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

        return root !== undefined && root.equals(op.getAuthor()) && op.causalOps === undefined;
    }

    isAdminOp(op: MutationOp, opReferences: Map<Hash, HashedObject>, admin?: Identity): boolean {

        opReferences;

        const causalUseOps = op.causalOps;
        if (causalUseOps === undefined || causalUseOps.size() !== 1) {
            return false;
        }

        const causalGrantOp = causalUseOps.values().next().value as MutationOp;

        if (!(causalGrantOp instanceof GrantCapabilityOp)) {
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

            if (op instanceof GrantCapabilityOp) {
                if (op.capability === 'admin' && this.isRootOp(op)) {
                    return true;
                } else if (op.capability === 'user' && (this.isRootOp(op) || this.isAdminOp(op, opReferences))) {
                    return true;
                } else {
                    return false;
                }
            } else if (op instanceof RevokeCapabilityAfterOp) {
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
            grantOp = new GrantCapabilityOp(this, id, 'admin');
            grantOp.setAuthor(this.getAuthor() as Identity);
            return this.applyNewOp(grantOp).then(() => true);
        } else {
            return Promise.resolve(false);
        }
    }

    removeAdmin(id: Identity): Promise<boolean> {

        const applies: Array<Promise<void>> = []

        for (const grantOp of this.findAllValidGrants(id, 'admin').values()) {
            const revokeOp = new RevokeCapabilityAfterOp(grantOp);
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
            const grantOp = new GrantCapabilityOp(this, id, 'user');
            if (admin === undefined) {
                
                grantOp.setAuthor(this.getAuthor() as Identity);
                return this.applyNewOp(grantOp).then(() => true);

            } else {

                grantOp.setAuthor(admin);
                //grantOp.setPrevOps(this._terminalOps.values());
                //const useAdminOp = this.useCapabilityForOp(admin, 'admin', grantOp);
                const adminGrantOp = this.findValidGrant(admin, 'admin');
                if (adminGrantOp !== undefined) {
                    grantOp.addCausalOp('admin-grant-op', adminGrantOp);
                    return this.applyNewOp(grantOp).then(() => true);
                } else {
                    return Promise.reject(new Error(admin.hash() + " cannot grant 'user' capability to " + id.hash() + ": there is no valid 'admin' grant."));
                }
            }
            
        } else {
            return Promise.resolve(false);
        }
    }

    removeUser(id: Identity, admin?: Identity): Promise<boolean> {

        const applies: Array<Promise<void>> = [];

        const allValidGrants = this.findAllValidGrants(id, 'user');

        const revoker = admin === undefined? this.getAuthor() as Identity : admin;
        const adminGrantOp = admin === undefined? undefined : this.findValidGrant(admin, 'admin');

        if (admin !== undefined && adminGrantOp === undefined) {
            return Promise.reject(new Error(admin.hash() + " cannot revoke 'user' capability for " + id.hash() + ": there is no valid 'admin' grant."));
        }

        for (const grantOp of allValidGrants.values()) {

            const revokeOp = new RevokeCapabilityAfterOp(grantOp);
            revokeOp.setAuthor(revoker);
            if (adminGrantOp !== undefined) {
                revokeOp.addCausalOp('admin-grant-op', adminGrantOp);
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