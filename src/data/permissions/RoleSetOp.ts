import { ReversibleOp } from 'data/model/ReversibleOp';
import { RoleSet } from './RoleSet';
import { HashedSet } from 'data/model/HashedSet';
import { MutationOp } from 'data/model/MutationOp';


type RoleSetAction = 'grant-role'|'revoke-role'|'use-role'|'grant-admin'|'revoke-admin';

class RoleSetOp extends ReversibleOp {

    static className = 'hhs/RoleSetOp';

    action?: RoleSetAction;
    role?: string;
    
    constructor(target?: RoleSet, prevOps?: HashedSet<MutationOp>, dependsUpon?: HashedSet<ReversibleOp>, action?: RoleSetAction, role?: string) {
        super(target, prevOps, dependsUpon);
        this.action = action;
        this.role   = role;
    }

    getClassName() {
        return RoleSetOp.className;
    }

    getAction() {
        return this.action as RoleSetAction;
    }

    
    getRole() {
        return this.role as string;
    }


}

export { RoleSetOp };