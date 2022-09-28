import { HashedSet } from '../../model/immutable/HashedSet';
import { MutableObject, MutableObjectConfig } from '../../model/mutable/MutableObject';
import { Identity } from '../../identity';

type CollectionConfig = {writer?: Identity, writers?: IterableIterator<Identity>};

abstract class Collection extends MutableObject {
    writers?: HashedSet<Identity>;  //if writers is missing, anybody can write

    constructor(acceptedOpClasses : Array<string>, config?: MutableObjectConfig & CollectionConfig) {
        super(acceptedOpClasses, config);

        this.writers = new HashedSet<Identity>();

        if (config?.writer !== undefined) {
            this.writers.add(config?.writer);
        }

        if (config?.writers !== undefined) {
            for (const writer of config.writers) {
                this.writers.add(writer);
            }
        }

        if (this.writers.size() === 0) {
            this.writers = undefined;
        }

        this.setRandomId();
    }

    hasSingleWriter() {
        return this.writers !== undefined && this.writers.size() === 1;
    }

    // throws if there isn't exactly one writer
    getSingleWriter() {
       if (this.writers === undefined)  {
           return undefined;
       } else if (this.writers.size() > 1) {
           throw new Error('Called getWriter() on a mutableSet, but it has more than one');
       } else {
           return this.writers.values().next().value;
       }
    }

    addWriter(writer: Identity) {
        this.writers?.add(writer);
    }

    getWriters() {
        return this.writers;
    }

    hasWriters() {
        return this.writers !== undefined;
    }
}

export { Collection };
export type { CollectionConfig };