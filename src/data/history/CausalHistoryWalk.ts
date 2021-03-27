import { Hash } from "data/model/Hashing";
import { CausalHistoryFragment } from "./CausalHistoryFragment";
import { OpCausalHistory } from "./OpCausalHistory";

type Config = {
    direction: 'forward'|'backward'
};

class CausalHistoryWalk implements IterableIterator<OpCausalHistory> {

    direction: 'forward'|'backward';

    fragment : CausalHistoryFragment;

    visited : Set<Hash>;

    queue         : Array<Hash>;
    queueContents : Set<Hash>;

    constructor(direction: 'forward'|'backward', initial: Set<Hash>, fragment: CausalHistoryFragment) {

        this.direction = direction;
        
        this.fragment = fragment;

        this.visited = new Set();

        
        this.queue         = [];
        this.queueContents = new Set();
        
        for (const hash of initial.values()) {
            this.enqueueIfNew(hash);
        }
    }

    next(): IteratorResult<OpCausalHistory, any> {
        if (this.queue.length > 0) {
            const hash = this.dequeue();
            for (const succ of this.goFrom(hash)) {

                // if succ is in fragment.missing do not go there
                if (this.fragment.contents.has(succ)) {
                    this.enqueueIfNew(succ);
                }
            }

            const nextOp = this.fragment.contents.get(hash);

            if (nextOp === undefined) {
                throw new Error('Missing op history found while walking history fragment, probably includeInitial=true and direction=forward where chosen that are an incompatible pair')
            }

            return { value: nextOp, done: false };
        } else {
            return { done: true, value: undefined };
        }
    }

    [Symbol.iterator]() {
        return this;
    }

    private enqueueIfNew(what: Hash) {
        if (!this.visited.has(what) && !this.queueContents.has(what)) {
            this.queue.push(what);
            this.queueContents.add(what);
        }
    }

    private dequeue(): Hash {
        const result = this.queue.shift() as Hash;
        this.queueContents.delete(result);

        return result;
    }

    private goFrom(opHistoryHash: Hash) {
        if (this.direction === 'forward') {
            return this.goForwardFrom(opHistoryHash);
        } else {
            return this.goBackwardFrom(opHistoryHash);
        }
    }

    private goForwardFrom(opHistoryHash: Hash): Set<Hash> {
        return this.fragment.nextOpHistories.get(opHistoryHash);
    }

    private goBackwardFrom(opHistoryHash: Hash): Set<Hash> {
        const history = this.fragment.contents.get(opHistoryHash);

        if (history !== undefined) {
            return history.prevOpHistories;
        } else {
            return new Set();
        }
    }

}

export { CausalHistoryWalk, Config as WalkConfig };