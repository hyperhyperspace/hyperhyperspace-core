import { HashedObject } from './HashedObject';
import { Context } from './Context';  
import { MutableObject } from './MutableObject';
import { HashedSet } from './HashedSet';
import { Hash } from './Hashing';
import { HashReference } from './HashReference';
import { OpCausalHistory, OpCausalHistoryProps } from 'data/history/OpCausalHistory';

abstract class MutationOp extends HashedObject {

    target?  : MutableObject;
    prevOps? : HashedSet<HashReference<MutationOp>>;

    constructor(target?: MutableObject) {
        super();
        this.target  = target;
    }

    async validate(references: Map<Hash, HashedObject>) {

        if (this.target === undefined) {
            return false;
        }

        if (this.prevOps === undefined) {
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
        
        return true;

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

    getCausalHistory(prevOpCausalHistories: Map<Hash, Hash | OpCausalHistory> ): OpCausalHistory {
        return new OpCausalHistory(this, prevOpCausalHistories);
    }

    getCausalHistoryProps(): OpCausalHistoryProps {
        return new Map();
    }

}

export { MutationOp }