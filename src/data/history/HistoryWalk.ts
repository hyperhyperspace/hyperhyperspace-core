import { Hash } from 'data/model/Hashing';
import { CausalHistoryFragment } from './CausalHistoryFragment';
import { OpCausalHistory } from './OpCausalHistory';

type Config = {
    direction: 'forward'|'backward'
};

abstract class HistoryWalk {
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


    abstract next(): IteratorResult<OpCausalHistory, any>;


    [Symbol.iterator]() {
        return this;
    }


    protected enqueueIfNew(what: Hash) {
        if (!this.visited.has(what) && !this.queueContents.has(what)) {
            this.enqueue(what);
        }
    }


    protected enqueue(what: Hash) {
        this.queue.push(what);
        this.queueContents.add(what);
    }

    protected dequeue(): Hash {
        const result = this.queue.shift() as Hash;
        this.queueContents.delete(result);

        return result;
    }

    protected goFrom(opHistoryHash: Hash) {
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

export { HistoryWalk, Config as WalkConfig };