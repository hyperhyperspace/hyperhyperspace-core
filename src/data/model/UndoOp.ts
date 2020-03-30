import { MutationOp } from './MutationOp';
import { HashedSet } from './HashedSet';
import { MutableObject } from './MutableObject';
import { ReversibleOp } from './ReversibleOp';


class UndoOp extends MutationOp {
    targetOp?: ReversibleOp;
    cascadeOf?: UndoOp;

    constructor(target?: MutableObject, targetOp?: ReversibleOp, cascadeOf?: UndoOp) {
        super(target, targetOp === undefined? undefined : new HashedSet([targetOp].values()));

        if (targetOp instanceof UndoOp) {
            throw new Error("And undo op can't be undone this way, please just re-issue the original op");
        }

        if (targetOp !== undefined) {
            this.targetOp = targetOp;
        }

        if (cascadeOf !== undefined) {
            this.cascadeOf = cascadeOf;
        }
    }

    getTargetOp() : MutationOp {
        return this.targetOp as MutationOp;
    }

}

export { UndoOp }