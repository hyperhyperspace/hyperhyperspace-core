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

    constructor(acceptedOpClasses : Array<string>) {
        super(acceptedOpClasses.concat([UndoOp.className]));
    }

    protected async apply(op: MutationOp) : Promise<void> {
        if (op instanceof UndoOp) {
            await this.reverseMutation(op);
        } else {
            await this.mutate(op);
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