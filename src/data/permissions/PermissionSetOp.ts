import { ReversibleOp } from 'data/model/ReversibleOp';
import { PermissionSet } from './PermissionSet';
import { HashedSet } from 'data/model/HashedSet';
import { Identity } from 'data/identity/Identity';


type PermissionSetAction = 'grant-perm'|'revoke-perm'|'use-perm'|'grant-admin'|'revoke-admin';

class PermissionSetOp extends ReversibleOp {

    static className = 'hhs/RoleSetOp';

    authOp?: PermissionSetOp;
    action?: PermissionSetAction;
    recipient?: Identity;
    permissionName?: PermissionName;
    
    constructor(target?: PermissionSet, action?: PermissionSetAction, permissionName?: PermissionName, recipient?: Identity, authOp?: PermissionSetOp) {
        super(target, authOp === undefined? undefined : new HashedSet([authOp].values()));

        this.authOp = authOp;
        this.action = action;
        this.recipient = recipient;
        this.permissionName   = permissionName;
    }

    init() {
        if (this.action === undefined) {
            throw new Error('Action field is mandatory for PermissionSetOp objects.');
        }

        if (this.permissionName === undefined) {
            throw new Error('Name field is mandatory for PermissionSetOp objects.');
        }

        if (this.getTarget().getClassName() !== PermissionSet.className) {
            throw new Error('A PermissionSetOp is expected to have a PermissionSet as its target.');
        }

        let target = this.getTarget() as PermissionSet;


        if (this.getAuthor() === undefined) {
            throw new Error('A PermissionSetOp is expeted to have an author.');
        }

        let author = this.getAuthor() as Identity;

        let isOwner = false;

        if (target.getOwners().has(author)) {
            isOwner = true;
        }

        if (this.action === 'grant-perm') {
            
            if (isOwner) {
                if (this.authOp !== undefined) {
                    throw new Error('Identity ' + author.hash() + ' has an authOp for PermissionSetOp ' + this.hash() + ' but it is an owner of the PermissionSet, so it would be redundant and is disallowed.');
                }
            } else {

            }

        }
    }

    getClassName() {
        return PermissionSetOp.className;
    }

    getAction() {
        return this.action as PermissionSetAction;
    }

    isGrantFor(_id: Identity, _permissionName: PermissionName) {
        //return this.action === 'grant-perm' && this.;
    }

    
    getPermissionName() {
        return this.permissionName as string;
    }


}

export { PermissionSetOp };