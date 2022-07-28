import { Hash } from 'data/model/hashing/Hashing';
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
    queueContents : Map<Hash, number>;

    filter? : (opHeader: Hash) => boolean;

    constructor(direction: 'forward'|'backward', initial: Set<Hash>, fragment: HistoryFragment, filter?: (opHistory: Hash) => boolean) {

        this.direction = direction;
        
        this.fragment = fragment;

        this.visited = new Set();

        
        this.queue         = [];
        this.queueContents = new Map();

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
        if (!this.queueContents.has(what)) {
            this.enqueue(what);
        }
    }


    protected enqueue(what: Hash) {
       

        //if (!this.visited.has(what)) {
            this.queue.push(what);
            const count = this.queueContents.get(what) || 0;
            this.queueContents.set(what, count+1);
        //}
    }

    protected dequeue(): Hash {
        const result = this.queue.shift() as Hash;
        
        const count = this.queueContents.get(result) as number;
        if (count === 1) {
            this.queueContents.delete(result);
        } else {
            this.queueContents.set(result, count - 1);
        }

        return result;
    }

    protected goFrom(opHeaderHash: Hash) {

        if (this.visited.has(opHeaderHash)) {
            return new Set<Hash>();
        }

        this.visited.add(opHeaderHash);

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
                if (this.filter === undefined || this.filter(hash)) {
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