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

    toLiteral() {
        const result : {
            inner: {[key: keyof any]: V[]},
        } = {
            inner: {},
        };
        for (const [key, value] of this.inner.entries()) {
            if (typeof key !== "string" && typeof key !== "number" && typeof key !== "symbol") {
                throw new Error("ArrayMap key type isn't supported for literalization");
            }
            result.inner[key as keyof any | number | string | symbol] = Array.from(value.values());
        }
        return result;
    }
    
    static fromLiteral<K extends keyof any | string | number | symbol, V>(literal: {
        inner: {[key: keyof any]: V[]},
    }) {
        const result = new DedupMultiMap<K, V>();
        for (const key in literal.inner) {
            const iter = literal.inner[key][Symbol.iterator]();
            result.inner.set(key as K, new HashedSet(iter));
        }
        return result; 
    }
}

export { DedupMultiMap };