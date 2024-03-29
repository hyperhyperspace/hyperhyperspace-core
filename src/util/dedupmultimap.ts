import { HashedSet } from 'data/model';

class DedupMultiMap<K, V> {
    inner: Map<K, HashedSet<V>>;
    
    constructor() {
        this.inner = new Map();
    }

    add(key: K, value: V): void {
        let s = this.inner.get(key);

        if (s === undefined) {
            s = new HashedSet();
            this.inner.set(key, s);
        }

        s.add(value);
    }

    delete(key: K, value: V): boolean {
        let s = this.inner.get(key);

        if (s === undefined) {
            return false;
        }

        let ret = s.remove(value);

        if (s.size() === 0) {
            this.inner.delete(key);
        }

        return ret;
    }

    deleteKey(key: K): boolean {
        return this.inner.delete(key);
    }

    get(key: K): Set<V> {
        let result = this.inner.get(key);
        
        if (result === undefined) {
            return new Set();
        } else {
            return new Set(result.values());
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

    entries() {
        return this.inner.entries();
    }
    
    static fromEntries<K, V>(entries: IterableIterator<[K, HashedSet<V>]>): DedupMultiMap<K, V> {
        const result = new DedupMultiMap<K, V>();
        result.inner = new Map(entries);
        return result
    }
    
    static fromIterableEntries<K, V>(entries: IterableIterator<[K, IterableIterator<V>]>): DedupMultiMap<K, V> {
        const result = new DedupMultiMap<K, V>();
        result.inner = new Map([...entries].map(([k, v]) => [k, new HashedSet(v)]));
        return result;
    }
}

export { DedupMultiMap };