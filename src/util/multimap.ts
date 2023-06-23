
class MultiMap<K, V> {
    
    inner: Map<K, Set<V>>;
    size: number;
    
    constructor() {
        this.inner = new Map();
        this.size  = 0;
    }

    add(key: K, value: V): void {
        let s = this.inner.get(key);

        if (s === undefined) {
            s = new Set();
            this.inner.set(key, s);
        }

        if (!s.has(value)) {
            s.add(value);
            this.size = this.size + 1;
        }
        
    }

    addMany(key: K, values: IterableIterator<V>) {
        for (const value of values) {
            this.add(key, value);
        }
    }

    delete(key: K, value: V): boolean {
        let s = this.inner.get(key);

        if (s === undefined) {
            return false;
        }

        let ret = s.delete(value);

        if (s.size === 0) {
            this.inner.delete(key);
        }

        if (ret) {
            this.size = this.size - 1;
        }

        return ret;
    }

    deleteKey(key: K): boolean {

        const vals = this.inner.get(key);

        if (vals !== undefined) {
            this.size = this.size - vals.size;
        }

        return this.inner.delete(key);
    }

    get(key: K): Set<V> {
        let result = this.inner.get(key);
        
        if (result === undefined) {
            return new Set();
        } else {
            return new Set(result);
        }
    }

    hasKey(key: K): boolean {
        return this.inner.has(key);
    }

    has(key: K, value: V): boolean {
        const kv = this.inner.get(key);
        return kv !== undefined && kv.has(value);
    }

    asMap() {
        return new Map(this.inner.entries());
    }

    keys() {
        return this.inner.keys();
    }

    values() {
        return this.inner.values();
    }

    entries() {
        return this.inner.entries();
    }
    
    static fromEntries<K, V>(entries: IterableIterator<readonly [K, Set<V>]>): MultiMap<K, V> {
        const result = new MultiMap<K, V>();
        result.inner = new Map([...entries].map(([k, v]) => [k, new Set(v)]));

        return result;
    }

    clone() {
        const clone = new MultiMap<K, V>();

        for (const [k, s] of this.inner.entries()) {
            clone.inner.set(k, new Set(s));
        }

        return clone;
    }
}

export { MultiMap };