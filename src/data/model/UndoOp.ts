import { MutationOp } from './MutationOp';
import { HashedObject } from './HashedObject';
import { InvalidateAfterOp } from './InvalidateAfterOp';
import { RedoOp } from './RedoOp';
import { CascadedInvalidateOp } from './CascadedInvalidateOp';

class UndoOp extends CascadedInvalidateOp {

    static className = 'hhs/v0/UndoOp';

    targetOp?: MutationOp; // the op that will be undone

    constructor(causalOp?: InvalidateAfterOp|UndoOp|RedoOp, targetOp?: MutationOp) {
        super(true, causalOp, targetOp);
    }
    
    getClassName() {
        return UndoOp.className;
    }

    init() {

    }

}

HashedObject.registerClass(UndoOp.className, UndoOp);

export { UndoOp }