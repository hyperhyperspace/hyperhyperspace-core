import { HashedObject } from './HashedObject';
import { Context } from './Context';  
import { MutableObject } from './MutableObject';
import { HashedSet } from './HashedSet';
import { Hash } from './Hashing';
import { HashReference } from './HashReference';
import { OpCausalHistory, OpCausalHistoryProps } from 'data/history/OpCausalHistory';
import { InvalidateAfterOp } from './InvalidateAfterOp';

abstract class MutationOp extends HashedObject {

    target?  : MutableObject;
    prevOps? : HashedSet<HashReference<MutationOp>>;

    consequenceOf?: HashedSet<HashReference<MutationOp>>;

    constructor(target?: MutableObject, consequenceOf?: IterableIterator<MutationOp>) {
        super();

        if (target !== undefined) {
            this.target = target;
            if (consequenceOf !== undefined) {
                this.consequenceOf = new HashedSet(Array.from(consequenceOf).map((op: MutationOp) => op.createReference()).values());
            }
        }
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        if (this.target === undefined) {
            return false;
        }

        if (!(this.target instanceof MutableObject)) {
            return false;
        }

        if (this.prevOps === undefined) {
            return false;
        }

        if (!(this.prevOps instanceof HashedSet)) {
            return false;
        }

        for (const prevOpRef of this.prevOps.values()) {
            let prevOp = references.get(prevOpRef.hash);

            if (prevOp === undefined) {
                return false;
            } else if (! (prevOp instanceof MutationOp)) {
                return false
            } else if (! ((prevOp as MutationOp).target as MutableObject).equals(this.target)) { 
                return false;
            }
        }

        if (!this.target.shouldAcceptMutationOp(this)) {
            return false;
        }
        
        return true;

    }

    shouldAcceptInvalidateAfterOp(op: InvalidateAfterOp): boolean {
        op;
        return false;
    }

    getTarget() : MutableObject {
        return this.target as MutableObject;
    }

    setTarget(target: MutableObject) {
        this.target = target;
    }

    getPrevOps() : IterableIterator<HashReference<MutationOp>> {
        return (this.prevOps as HashedSet<HashReference<MutationOp>>).values();
    }

    getPrevOpsIfPresent() : IterableIterator<HashReference<MutationOp>> | undefined {
        if (this.prevOps === undefined) {
            return undefined;
        } else {
            return (this.prevOps as HashedSet<HashReference<MutationOp>>).values();
        }
        
    }

    setPrevOps(prevOps: IterableIterator<MutationOp>) {
        this.prevOps = new HashedSet(Array.from(prevOps).map((op: MutationOp) => op.createReference()).values());
    }

    literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('op');

        return super.literalizeInContext(context, path, flags);

    }

    getCausalHistory(prevOpCausalHistories: Map<Hash, OpCausalHistory> ): OpCausalHistory {
        return new OpCausalHistory(this, prevOpCausalHistories);
    }

    getCausalHistoryProps(prevOpCausalHistories: Map<Hash, OpCausalHistory>): OpCausalHistoryProps {
        prevOpCausalHistories;
        return new Map();
    }

    isConsequence() {
        return this.consequenceOf !== undefined;
    }

}

export { MutationOp }