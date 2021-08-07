import { Hash } from 'data/model/Hashing';
import { HistoryFragment } from './HistoryFragment';
import { OpHeader } from './OpHeader';

type Config = {
    direction: 'forward'|'backward'
};

abstract class HistoryWalk {
    direction: 'forward'|'backward';

    fragment : HistoryFragment;

    visited : Set<Hash>;

    queue         : Array<Hash>;
    queueContents : Set<Hash>;

    filter? : (opHeader: Hash) => boolean;

    constructor(direction: 'forward'|'backward', initial: Set<Hash>, fragment: HistoryFragment, filter?: (opHistory: Hash) => boolean) {

        this.direction = direction;
        
        this.fragment = fragment;

        this.visited = new Set();

        
        this.queue         = [];
        this.queueContents = new Set();

        this.filter = filter;
        
        for (const hash of initial.values()) {
            if (this.fragment.contents.has(hash) && (filter === undefined || filter(hash))) {
                this.enqueueIfNew(hash);
            }
        }
    }


    abstract next(): IteratorResult<OpHeader, any>;


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

    protected goFrom(opHeaderHash: Hash) {

        let unfiltered: Set<Hash>;

        if (this.direction === 'forward') {
            unfiltered = this.goForwardFrom(opHeaderHash);
        } else {
            unfiltered = this.goBackwardFrom(opHeaderHash);
        }

        if (this.filter === undefined) {
            return unfiltered;
        } else {
            const filtered = new Set<Hash>();
            for (const hash of unfiltered.values()) {
                if (this.filter(hash)) {
                    filtered.add(hash);
                }
            }
            return filtered;
        }
        
    }

    private goForwardFrom(opHeaderHash: Hash): Set<Hash> {
        return this.fragment.nextOpHeaders.get(opHeaderHash);
    }

    private goBackwardFrom(opHeaderHash: Hash): Set<Hash> {
        const history = this.fragment.contents.get(opHeaderHash);

        if (history !== undefined) {
            return history.prevOpHeaders;
        } else {
            return new Set();
        }
    }
}

export { HistoryWalk, Config as WalkConfig };