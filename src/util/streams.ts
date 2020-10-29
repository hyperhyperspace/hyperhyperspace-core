

interface AsyncStream<T> {

    // Wait the prescribed time for the next result.
    next(timeoutMillis: number): Promise<T>;

    // Return the next element immediately if it is available.
    nextIfAvailable(): T | undefined;

    // Tell how many buffered elements we have.
    countAvailableItems(): number;

    // Close this stream and free resources.
    close(): void;

    // True if either the source has informed that there are no more
    // items, and the buffer has been consumed
    // 
    //    OR
    // 
    // the close() method above has been called.
    atEnd(): boolean;
}

interface AsyncStreamSource<T> {

    current(): T[];

    subscribeItem(cb: (elem: T) => void): void;
    subscribeEnd(cb: () => void): void;

    unsubscribeItem(cb: (elem: T) => void): void;
    unsubscribeEnd(cb: () => void): void;
}

class FilteredAsyncStreamSource<T> implements AsyncStreamSource<T> {

    upstream: AsyncStreamSource<T>;
    filter: (elem: T) => boolean;

    itemSubscribers: Set<(elem: T) => void>;
    endSubscribers: Set<() => void>;

    upstreamItemCallback: (elem: T) => void;
    upstreamEndCallback: () => void;

    constructor(upstream: AsyncStreamSource<T>, filter: (elem: T) => boolean) {
        this.upstream = upstream;
        this.filter = filter;

        this.itemSubscribers = new Set();
        this.endSubscribers = new Set();

        this.upstreamItemCallback = (elem: T) => {        
            if (this.filter(elem)) {
                for (const subscribeItem of this.itemSubscribers) {
                    subscribeItem(elem);
                }
            }
        };

        this.upstreamEndCallback = () => {
            for (const subscribeEnd of this.endSubscribers) {
                subscribeEnd();
            }
        };

    }

    current(): T[] {
        return this.upstream.current().filter(this.filter);
    }

    subscribeItem(cb: (elem: T) => void): void {

        const doSubscribe =  this.itemSubscribers.size === 0

        this.itemSubscribers.add(cb);

        if (doSubscribe) {
            this.upstream.subscribeItem(this.upstreamItemCallback);
        }
    }

    subscribeEnd(cb: () => void): void {

        const doSubscribe = this.endSubscribers.size === 0;

        this.endSubscribers.add(cb);

        if (doSubscribe) {
            this.upstream.subscribeEnd(this.upstreamEndCallback);
        }
    }

    unsubscribeItem(cb: (elem: T) => void): void {
        
        const beforeSize = this.itemSubscribers.size;
        this.itemSubscribers.delete(cb);
        if (beforeSize > 0 && this.itemSubscribers.size === 0) {
            this.upstream.unsubscribeItem(this.upstreamItemCallback);
        }

    }

    unsubscribeEnd(cb: () => void): void {
        const beforeSize = this.endSubscribers.size;
        this.endSubscribers.delete(cb);
        if (beforeSize > 0 && this.endSubscribers.size === 0) {
            this.upstream.unsubscribeEnd(this.upstreamEndCallback);
        }
    }
    
}

class SubscribedAsyncStream<T> implements AsyncStream<T> {

    provider: AsyncStreamSource<T>;
    buffer: T[];
    pending: {resolve: (value?: T) => void, reject: (reason: any) => void}[];

    itemCallback: (elem: T) => void;
    endCallback: () => void;

    isAtEnd = false;
    isClosed = false;

    constructor(provider: AsyncStreamSource<T>) {
        this.provider = provider;
        this.buffer = this.provider.current();
        this.pending = [];

        this.itemCallback = (elem: T) => {
            
            if (this.pending.length > 0) {
                this.pending.shift()?.resolve(elem);
            } else {
                this.buffer.push(elem);
            }

        };

        this.endCallback = () => {
            let toReject = this.pending;
            this.pending = [];
            for (const p of toReject) {
                p.reject('end');
            }
            this.isAtEnd = true;
        };

        this.provider.subscribeItem(this.itemCallback);
        this.provider.subscribeEnd(this.endCallback);

    }

    next(timeoutMillis: number) : Promise<T> {

        if (this.buffer.length > 0) {
            return Promise.resolve(this.buffer.shift() as T);
        } else {
            let p = new Promise((resolve: (value?: T) => void, reject: (reason: 'timeout'|'end') => void) => {
                
                this.pending.push({resolve: resolve, reject: reject});
                
                setTimeout(() => {
                    let idx = -1;
    
                    for (let i=0; i<this.pending.length; i++) {
                        if (this.pending[i].resolve === resolve) {
                            idx = i;
                        }
                    }
    
                    if (idx >= 0) {
                        this.pending.splice(idx, 1);
                    }
    
                    reject('timeout');
    
                }, timeoutMillis);
               
            });
    
            return p;
        }
    }

    nextIfAvailable() : T | undefined {
        if (this.buffer.length > 0) {
            return this.buffer.shift();
        } else {
            return undefined;
        }
    }

    countAvailableItems(): number {
        return this.buffer.length;
    }

    close() {
        this.provider.unsubscribeItem(this.itemCallback);
        this.provider.unsubscribeEnd(this.endCallback);
        this.isClosed = true;
    }

    atEnd() : boolean {
        return this.isClosed || (this.isAtEnd && this.buffer.length === 0);
    }
}

export { AsyncStream, SubscribedAsyncStream, AsyncStreamSource, FilteredAsyncStreamSource }

// in case we want to make this support async iteration, this

/*

class Stream<T> implements AsyncIterator<T> {
    next(...args: [] | [undefined]) : Promise<IteratorResult<T, any>> {

        throw new Error();

    }
}


class InterruptibleStream<T> extends Stream<T> {

}

class Stream2<T> {

    [Symbol.iterator]() : AsyncIterator<T> {
        return new Stream<T>();
    }

}

class SequencePromise<T> {

    seq: T[];

    constructor() {
        this.seq = [];
    }

    async t() {
        let s = new Stream2<number>();

        for await (const x of s) {
            
        }
    }

    values(): IterableIterator<T> {
        throw new Error();
    }

    next(_timeout: number): Promise<T> {
        throw new Error();
    }

}

*/