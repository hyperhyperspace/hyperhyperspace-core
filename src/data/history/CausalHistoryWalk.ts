import { Hash } from "data/model/Hashing";
import { CausalHistoryFragment } from "./CausalHistoryFragment";
import { OpCausalHistory } from "./OpCausalHistory";

type Config = {
    direction: 'forward'|'backward',
    includeInitial: boolean
}

class CausalHistoryWalk implements IterableIterator<OpCausalHistory> {

    config   : Config;

    initial  : Set<Hash>;
    fragment : CausalHistoryFragment;

    visited : Set<Hash>;

    queue         : Array<Hash>;
    queueContents : Set<Hash>;

    constructor(config: Config, initial: Set<Hash>, fragment: CausalHistoryFragment) {

        if (config.direction === 'forward' && config.includeInitial) {
            throw new Error("Cannot create a causal history walk with direction 'forward' and includeInitial=true, since the initial elements are missing in this case!");
        }

        this.config = config;
        
        this.initial  = initial;
        this.fragment = fragment;

        this.visited = new Set();

        
        this.queue         = [];
        this.queueContents = new Set();
        
        for (const hash of initial.values()) {
            if (config.includeInitial) {
                this.enqueueIfNew(hash);
            } else {
                for (const succ of this.goFrom(hash)) {
                    this.enqueueIfNew(succ);
                }
            }
        }
    }

    next(): IteratorResult<OpCausalHistory, any> {
        if (this.queue.length > 0) {
            const hash = this.dequeue();
            for (const succ of this.goFrom(hash)) {
                this.enqueueIfNew(succ);
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
        if (this.config.direction === 'forward') {
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