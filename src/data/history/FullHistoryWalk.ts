import { HistoryWalk } from './HistoryWalk';
import { OpHeader } from './OpHeader';



class FullHistoryWalk extends HistoryWalk implements IterableIterator<OpHeader> {

    next(): IteratorResult<OpHeader, any> {
        if (this.queue.length > 0) {

            const hash = this.dequeue();
            for (const succ of this.goFrom(hash)) {

                // if succ is in fragment.missing do not go there
                if (this.fragment.contents.has(succ)) {
                    this.enqueue(succ);
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

}

export { FullHistoryWalk };