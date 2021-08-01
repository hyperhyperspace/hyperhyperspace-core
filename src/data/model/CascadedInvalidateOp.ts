import { InvalidateAfterOp } from "./InvalidateAfterOp";
import { MutationOp } from "./MutationOp";


class CascadedInvalidateOp extends MutationOp {

    targetOp?: MutationOp;
    undo?: boolean;

    constructor(undo?: boolean, targetOp?: MutationOp, causalOp?: InvalidateAfterOp|CascadedInvalidateOp) {
        super(targetOp?.targetObject, causalOp === undefined? undefined : [causalOp].values());

        if (undo !== undefined) {
            this.undo = undo;
        }
        
    }

    getClassName(): string {
        throw new Error("Method not implemented.");
    }
    init(): void {
        throw new Error("Method not implemented.");
    }

}

export { CascadedInvalidateOp };