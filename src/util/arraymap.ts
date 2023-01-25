

class ArrayMap<K, V> {

    sorted : boolean;
    inner  : Map<K, V[]>;
    size   : number;

    constructor(sorted=true) {
        this.sorted = sorted;
        this.inner  = new Map();
        this.size   = 0;
    }

    add(key: K, value: V): void {

        let a = this.inner.get(key);
        if (a === undefined) {
            a = [];
            this.inner.set(key, a);
        }

        a.push(value);
        if (this.sorted) {
            a.sort();
        }

        this.size = this.size + 1;
    }

    delete(key: K, value: V): boolean {
        let a = this.inner.get(key);

        if (a === undefined) {
            return false;
        }

        const idx = a.indexOf(value);

        if (idx < 0) {
            return false;
        } else {
            a.splice(idx, 1);
            this.size = this.size - 1;
            if (a.length === 0) {
                this.inner.delete(key);
            }
            return true;
        }
    }

    deleteKey(key: K): boolean {

        const a = this.inner.get(key);

        if (a !== undefined) {
            this.size = this.size - a.length;
        }

        return this.inner.delete(key);
    }

    get(key: K): Array<V> {

        const a = this.inner.get(key);

        if (a === undefined) {
            return []
        } else {
            return Array.from(a);
        }

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
    
    static fromEntries<K, V>(entries: Iterable<[K, V[]]>): ArrayMap<K, V> {
        const result = new ArrayMap<K, V>();
        result.inner = new Map(entries);
        return result        
    }
}

export { ArrayMap };