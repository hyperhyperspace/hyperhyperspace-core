import { HashedObject } from './HashedObject';
import { InvalidateAfterOp } from './InvalidateAfterOp';
import { MutationOp } from './MutationOp';
import { CascadedInvalidateOp } from './CascadedInvalidateOp';
import { UndoOp } from './UndoOp';


class RedoOp extends CascadedInvalidateOp {

    static className = 'hhs/v0/RedoOp';

    targetOp?: MutationOp; // the op that will be undone

    constructor(targetOp?: MutationOp, causalOp?: InvalidateAfterOp|UndoOp|RedoOp) {
        super(false, targetOp, causalOp);
    }

   

    getClassName() {
        return RedoOp.className;
    }

    init() {

    }

}

HashedObject.registerClass(RedoOp.className, RedoOp);

export { RedoOp }