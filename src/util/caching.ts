
class LRUCache<K, V> {

    capacity: number;
    contents: Map<K, V>;
    
    constructor(capacity: number) {
        this.capacity = capacity;
        this.contents = new Map();
    }

    has(key: K): boolean {
        return this.contents.has(key);
    }

    get(key: K): (V | undefined) {

        const value = this.contents.get(key);

        if (value !== undefined) {
            this.contents.delete(key);
            this.contents.set(key, value);
        }

        return value;
    }

    set(key: K, value: V) {

        const wasCached = this.evict(key);

        if (this.contents.size > this.capacity-1) {
            this.evict(this.contents.keys().next().value);
        }

        this.contents.set(key, value);

        return wasCached;
    }

    evict(key: K) {
        const wasCached = this.contents.delete(key);

        return wasCached;
    }

    flush() {
        this.contents = new Map();
    }

}

export { LRUCache };