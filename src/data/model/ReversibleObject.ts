import { MutableObject } from './MutableObject'
import { MutationOp } from './MutationOp'
import { UndoOp } from './UndoOp';
import { Context } from './Context';
import { Hash } from './Hashing';


// A mutable object that can undo operations after they have
// been applied.

abstract class ReversibleObject extends MutableObject {
    
    // do as if op had never happened.
    abstract reverseMutation(op: UndoOp) : Promise<void>;

    constructor(acceptedOpClasses : Array<string>) {
        super(acceptedOpClasses.concat([UndoOp.className]));
    }

    protected async apply(op: MutationOp, isNew: boolean) : Promise<void> {
        if (op instanceof UndoOp) {
            await this.reverseMutation(op);
        } else {
            await this.mutate(op, isNew);
        }
    }

    literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('reversible');

        return super.literalizeInContext(context, path, flags);
    }

}

export { ReversibleObject  }