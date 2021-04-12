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

    validate(references: Map<Hash, HashedObject>) {

        if (this.target === undefined) {
            console.log('no target')
            return false;
        }

        if (this.prevOps === undefined) {
            console.log('no prevops')
            return false;
        }

        for (const prevOpRef of this.prevOps.values()) {
            let prevOp = references.get(prevOpRef.hash);

            if (prevOp === undefined) {
                console.log('prevop ' + prevOpRef.hash + ' missing from references')
                return false;
            } else if (! (prevOp instanceof MutationOp)) {
                console.log('prevop ' + prevOpRef.hash + ' is not a mutation op')
                return false
            } else if (! ((prevOp as MutationOp).target as MutableObject).equals(this.target)) { 
                console.log('prevop ' + prevOpRef.hash + ' points to a different target')
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