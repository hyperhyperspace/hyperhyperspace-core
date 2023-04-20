import { LinearizationOp } from './LinearizationOp';
import { LinearObject } from './LinearObject';

interface LinearizationRule<L extends LinearizationOp=LinearizationOp> {

    setTarget(target: LinearObject<L>): void;
    applyRule(op: L, opIsValid: boolean): Promise<boolean>;

}

export { LinearizationRule };