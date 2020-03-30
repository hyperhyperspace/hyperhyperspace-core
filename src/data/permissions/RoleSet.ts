import { ReversibleObject } from 'data/model/ReversibleObject';
import { TerminalOpSet } from 'data/model/state/TerminalOpSet'; 
import { HashedObject } from 'data/model/HashedObject';
import { Identity } from 'data/identity/Identity';
import { StateCallback } from 'data/model/MutableObject';
import { MutationOp } from 'data/model/MutationOp';
import { UndoOp } from 'data/model/UndoOp';

// grant, revoke and use capabilities.

// if a given capability is simultaneously revoked and used,
// issue a chain of reversions that undoes the consequencies
// of its usage.

class RoleSet extends ReversibleObject {

    _state: TerminalOpSet;
    owner?: Identity;

    constructor(owner: Identity) {
        super();
        this.owner = owner;
        this._state = TerminalOpSet.initialState(this);
    }

    currentState(): HashedObject {
        return this._state.currentState();
    }

    subscribeToCurrentState(callback: StateCallback): void {
        this._state.subscribeToCurrentState(callback);
    }

    unsubscribeFromCurrentState(callback: StateCallback): boolean {
        return this._state.unsubscribeFromCurrentState(callback);
    }

    validate(op: import("../model/MutationOp").MutationOp): boolean {
        throw new Error("Method not implemented.");
    }

    mutate(op: MutationOp): void {
        throw new Error("Method not implemented.");
    }

    validateUndo(op: UndoOp): boolean {
        throw new Error("Method not implemented.");
    }

    reverseMutation(op: MutationOp): void {
        throw new Error("Method not implemented.");
    }

}

export { RoleSet };