// A FIFO queue with O(1) enqueing and dequeing.

class Queue<T> {

    contents: Set<{elem: T}>;

    constructor() {
        this.contents = new Set();
    }

    enqueue(elem: T) {
        this.contents.add({elem: elem});
    }

    dequeue(): T {
        if (this.contents.size === 0) {
            throw new Error('Attemtped to dequeue from an empty queue');
        } else {
            const next = this.contents.values().next().value as {elem: T};
            this.contents.delete(next);

            return next.elem;
        }
    }

    size(): number {
        return this.contents.size;
    }

    isEmpty(): boolean {
        return this.contents.size === 0;
    }

}

export { Queue };