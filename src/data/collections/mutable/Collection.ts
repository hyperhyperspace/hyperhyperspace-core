import { HashedObject, HashedSet } from '../../model/immutable';
import { MutableObject, MutableObjectConfig, MutationOp } from '../../model/mutable';
import { Identity } from '../../identity';
import { Hash} from '../../model/hashing'


type CollectionConfig = {writer?: Identity, writers?: IterableIterator<Identity>};

interface Collection<T> {
    has(element: T): boolean;
    hasByHash(hash: Hash): boolean;
}

abstract class BaseCollection extends MutableObject {
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
    }

    async validate(references: Map<Hash, HashedObject>) {
        references;

        if (this.writers !== undefined) {
            if (!(this.writers instanceof HashedSet)) {
                return false;
            }

            if (this.writers.size() === 0) {
                return false;
            }

            for (const writer of this.writers.values()) {
                if (!(writer instanceof Identity)) {
                    return false;
                }
            }
        }

        return true;
    }

    hasSingleWriter() {
        return this.writers !== undefined && this.writers.size() === 1;
    }

    // throws if there isn't exactly one writer
    getSingleWriter() {
       if (this.writers === undefined)  {
           return undefined;
       } else if (this.writers.size() > 1) {
           throw new Error('Called getWriter() on a collection, but it has more than one writer');
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

abstract class CollectionOp extends MutationOp {

    constructor(targetObject?: BaseCollection) {
        super(targetObject);

        if (targetObject !== undefined) {
            if (targetObject.hasSingleWriter()) {
                this.setAuthor(targetObject.getSingleWriter());
            }
        }
    }

    init(): void {

    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }

        const targetObject = this.getTargetObject() as BaseCollection;
        const auth = this.getAuthor();

        if (targetObject.writers !== undefined && (auth === undefined || !targetObject.writers.has(auth))) {
            return false;
        }

        return true;
    }
    
}

export { Collection, BaseCollection, CollectionOp };
export type { CollectionConfig };