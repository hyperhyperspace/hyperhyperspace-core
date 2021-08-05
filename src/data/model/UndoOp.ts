import { MutationOp } from './MutationOp';
import { HashedObject } from './HashedObject';
import { InvalidateAfterOp } from './InvalidateAfterOp';
import { RedoOp } from './RedoOp';
import { CascadedInvalidateOp } from './CascadedInvalidateOp';

class UndoOp extends CascadedInvalidateOp {

    static className = 'hhs/v0/UndoOp';

    targetOp?: MutationOp; // the op that will be undone

    constructor(targetOp?: MutationOp, causalOp?: InvalidateAfterOp|UndoOp|RedoOp) {
        super(true, targetOp, causalOp);
    }
    
    getClassName() {
        return UndoOp.className;
    }

    init() {

    }

}

HashedObject.registerClass(UndoOp.className, UndoOp);

export { UndoOp }