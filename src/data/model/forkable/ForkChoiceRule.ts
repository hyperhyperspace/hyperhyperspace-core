import { LinearOp } from './LinearOp';
import { MergeOp } from './MergeOp';

// Note: shouldReplace is expected to be compatible with the order implicit in the prevLinearOp
//       linearization. Let's use a >> b if a "comes after" b in that order.
//
//        Then for all linearization ops a, b:
// 
//                         a >> b => shouldReplace(a, b)

interface ForkChoiceRule<L extends LinearOp=LinearOp, M extends MergeOp=MergeOp> {
    shouldReplaceCurrent(currentOp: L|M, newOp: L|M): boolean;
}

export { ForkChoiceRule };