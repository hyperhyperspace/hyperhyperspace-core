import { ReversibleObject } from 'data/model/ReversibleObject';
import { TerminalOpState } from 'data/model/state/TerminalOpsState.ts'; 
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
    
    owner?: Identity;

    _state: TerminalOpState;

    constructor(owner: Identity) {
        super();
        this.owner = owner;
        this._state = TerminalOpState.initialState(this);
    }

    loadState(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    currentState(): HashedObject {
        return this._state.currentState();
    }

    subscribeToCurrentState(callback: StateCallback): void {
        this._state.watchCurrentState(callback);
    }

    unsubscribeFromCurrentState(callback: StateCallback): boolean {
        return this._state.removeCurrentStateWatch(callback);
    }

    async validate(op: import("../model/MutationOp").MutationOp): Promise<boolean> {
        throw new Error("Method not implemented.");
    }

    async mutate(op: MutationOp): Promise<boolean> {
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