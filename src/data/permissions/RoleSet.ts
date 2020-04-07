import { ReversibleObject } from 'data/model/ReversibleObject';
import { HashedObject } from 'data/model/HashedObject';
import { Identity } from 'data/identity/Identity';
import { MutationOp } from 'data/model/MutationOp';
import { UndoOp } from 'data/model/UndoOp';
import { RoleSetOp } from './RoleSetOp';

// grant, revoke and use capabilities.

// if a given capability is simultaneously revoked and used,
// issue a chain of reversions that undoes the consequencies
// of its usage.

class RoleSet extends ReversibleObject {
    
    owner?: Identity;

    constructor(owner: Identity) {
        super([RoleSetOp.className]);
        this.owner = owner;
    }

    async mutate(op: MutationOp): Promise<boolean> {
        throw new Error("Method not implemented.");
    }

    reverseMutation(op: MutationOp): void {
        throw new Error("Method not implemented.");
    }

}

export { RoleSet };