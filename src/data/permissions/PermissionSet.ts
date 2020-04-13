import { ReversibleObject } from 'data/model/ReversibleObject';
import { Identity } from 'data/identity/Identity';
import { MutationOp } from 'data/model/MutationOp';
import { PermissionSetOp } from './PermissionSetOp';
import { HashedSet } from 'data/model/HashedSet';
import { Hash } from 'data/model/Hashing';

// grant, revoke and use capabilities.

// if a given capability is simultaneously revoked and used,
// issue a chain of reversions that undoes all the consequencies
// of its usage.

type Permission = string;
type PermissionUseStatus = 'valid'|'invalid'|'revoked';

class PermissionSet extends ReversibleObject {
    
    static className = 'hhs/RoleSet';

    owners: HashedSet<Identity>;

    constructor(owners: IterableIterator<Identity>) {
        super([PermissionSetOp.className]);
        this.owners = new HashedSet(owners);
    }

    getClassName(): string {
        return PermissionSet.className;
    }

    init(): void {

    }

    getOwners() : HashedSet<Identity> {
        return this.owners;
    }

    grantAdmin(_newAdmin: Identity) {

    }

    revokeAdmin(_oldAdmin: Identity) {

    }
    
    grantPermission(_byWhom: Identity, _name: Permission) {

    }

    revokePermission(_byWhom: Identity, _name: Permission) {

    }

    usePermission(_byWhom: Identity, _name: Permission, _target: Hash) {

    }

    checkPermissionUse() : PermissionUseStatus {
        throw new Error();
    }

    getAdmins() : Set<Identity> {
        throw new Error();
    }

    getPermissions(_id: Identity) : Set<Permission> {
        throw new Error();
    }


    async mutate(_op: MutationOp): Promise<boolean> {
        throw new Error("Method not implemented.");
    }

    async reverseMutation(_op: MutationOp): Promise<void> {
        throw new Error("Method not implemented.");
    }

}

export { PermissionSet, Permission };