import { HashedObject } from "../HashedObject";
import { HashedSet } from '../HashedSet';
import { MutationOp } from '../MutationOp';
import { HashReference } from '../HashReference';
import { MutableObject, StateCallback } from '../MutableObject';


class TerminalOpState extends HashedObject {

    mutable?: HashReference;
    terminalOps?: HashedSet<MutationOp>;

    _callbacks: Set<StateCallback>;

    constructor(mutable?: MutableObject, terminalOps?: HashedSet<MutationOp>) {
        super();
        if (mutable === undefined) {
            this.mutable = undefined;
        } else {
            this.mutable = HashReference.create(mutable);
        }
        
        this.terminalOps = terminalOps;
        this._callbacks = new Set();
    }

    static initialState(mutable: MutableObject) : TerminalOpState {
        return new TerminalOpState(mutable, new HashedSet());
    }

    updateState(op: MutationOp) {

        let changed = false;

        for (const prevOp of op.getPrevOps()) {
            changed = changed || (this.terminalOps as HashedSet<MutationOp>).remove(prevOp);
        }

        changed = changed || !this.terminalOps?.has(op);

        this.terminalOps?.add(op);

        if (changed) {
            for (const callback of this._callbacks) {
                callback((this.mutable as HashReference).hash);
            }
        }
    }

    currentState(): HashedObject {
       return this.clone();
    }

    watchCurrentState(callback: StateCallback): void {
        this._callbacks.add(callback);
    }

    removeCurrentStateWatch(callback: StateCallback): boolean {
        return this._callbacks.delete(callback);
    }

}

export { TerminalOpState };