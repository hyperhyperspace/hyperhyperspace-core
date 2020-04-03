import { MutableObject } from './MutableObject'
import { MutationOp } from './MutationOp'
import { UndoOp } from './UndoOp';
import { LiteralContext } from './HashedObject';
import { Hash } from './Hashing';


// A mutable object that can undo operations after they have
// been applied.

abstract class ReversibleObject extends MutableObject {
    
    // do as if op had never happened.
    abstract reverseMutation(op: UndoOp) : void;

    // should this undo op go through?
    abstract validateUndo(op: UndoOp) : boolean;

    apply(op: MutationOp) : void {
        if (op instanceof UndoOp) {
            this.reverseMutation(op);
            this.enqueueOpToSave(op);
        } else {
            super.apply(op);
        }
    }

    literalizeInContext(context: LiteralContext, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('reversible');

        return super.literalizeInContext(context, path, flags);

    }

}

export { ReversibleObject  }