
class MultiMap<K, V> {
    
    inner: Map<K, Set<V>>;
    
    constructor() {
        this.inner = new Map();
    }

    add(key: K, value: V) : void {
        let s = this.inner.get(key);

        if (s === undefined) {
            s = new Set();
            this.inner.set(key, s);
        }

        s.add(value);
    }

    delete(key: K, value: V) : boolean {
        let s = this.inner.get(key);

        if (s === undefined) {
            return false;
        }

        let ret = s.delete(value);

        if (s.size === 0) {
            this.inner.delete(key);
        }

        return ret;
    }

    deleteKey(key: K) : boolean {
        return this.inner.delete(key);
    }

    get(key: K) : Set<V> {
        let result = this.inner.get(key);
        
        if (result === undefined) {
            return new Set();
        } else {
            return new Set(result);
        }
    }

    asMap() {
        return new Map(this.inner.entries());
    }

    keys() {
        return this.inner.keys();
    }
}

export { MultiMap };