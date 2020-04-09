import { MutationOp } from './MutationOp';
import { MutableObject } from './MutableObject';
import { ReversibleOp } from './ReversibleOp';
import { Context } from './HashedObject';
import { Hash } from './Hashing';


class UndoOp extends MutationOp {

    static className = 'hhs/UndoOp';

    targetOp?: ReversibleOp;
    cascadeOf?: UndoOp;

    constructor(target?: MutableObject, targetOp?: ReversibleOp, cascadeOf?: UndoOp) {
        super(target);

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

    getClassName() {
        return UndoOp.className;
    }

    init() {

    }

    getTargetOp() : MutationOp {
        return this.targetOp as MutationOp;
    }

    literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('undo');

        return super.literalizeInContext(context, path, flags);

    }

}

export { UndoOp }