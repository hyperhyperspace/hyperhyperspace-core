import { HashedObject, HashedSet } from '../../model/immutable';
import { MutableObject, MutableObjectConfig, MutationOp } from '../../model/mutable';
import { Identity } from '../../identity';
import { Hash} from '../../model/hashing'


type CollectionConfig = {
    writer?: Identity,
    writers?: IterableIterator<Identity>,
    acceptedTypes?: Array<string>,
    acceptedElements?: Array<any>
};

interface Collection<T> {
    has(element: T): boolean;
    hasByHash(hash: Hash): boolean;
    values(): IterableIterator<T>;
}

// WARNING: CausalCollection extends this class and uses some of its fields directly,
//          so if this class changes, please check CausalCollection as well.

abstract class BaseCollection<T> extends MutableObject {
    writers?: HashedSet<Identity>;  //if writers is missing, anybody can write

    acceptedTypes?: HashedSet<string>;
    acceptedElementHashes?: HashedSet<Hash>;

    constructor(acceptedOpClasses : Array<string>, config?: MutableObjectConfig & CollectionConfig) {
        super(acceptedOpClasses, config);

        if (config?.writers !== undefined) {
            this.writers = new HashedSet<Identity>(config.writers);

            for (const writer of this.writers.values()) {
                if (!(writer instanceof Identity)) {
                    throw new Error('Causal collection: the config param "writers" contains an element that is not an instanfce of the Identity class');
                }
            }
        }

        if (config?.writer !== undefined) {
            if (config.writer instanceof Identity) {
                if (this.writers === undefined) {
                    this.writers = new HashedSet<Identity>([config.writer].values());
                } else {
                    this.writers.add(config?.writer);
                }
            } else {
                throw new Error('Causal collection: the config param "writer" must be an instance of the Identity class');
            }
        }

        if (this.writers !== undefined && this.writers.size() === 0) {
            this.writers = undefined;
        }

        if (config?.acceptedTypes !== undefined) {
            this.acceptedTypes = new HashedSet<string>(config.acceptedTypes.values());

            for (const acceptedType of this.acceptedTypes.values()) {
                if (typeof(acceptedType) !== 'string') {
                    throw new Error('Accepted types in a CausalCollection should be strings (either class names, or primitive type names)');
                }
            }
        }

        if (config?.acceptedElements !== undefined) {
            this.acceptedElementHashes = new HashedSet<Hash>();
            for (const acceptedElement of config.acceptedElements.values()) {
                this.acceptedElementHashes.add(HashedObject.hashElement(acceptedElement));
            }
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

        if (this.acceptedElementHashes !== undefined && this.acceptedElementHashes.size() === 0) {
            return false;
        }

        if (this.acceptedTypes !== undefined && this.acceptedTypes.size() === 0) {
            return false;
        }

        return true;
    }

    validateWriteAccess() {

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
        if (this.writers === undefined) {
            this.writers = new HashedSet<Identity>();
        }
        this.writers.add(writer);
    }

    getWriters() {
        return this.writers;
    }

    hasWriters() {
        return this.writers !== undefined;
    }

    validateAcceptedTypes(expected?: Array<string>): boolean {
        if (expected === undefined || expected.length === 0) {
            return this.acceptedTypes === undefined;
        } else {
            return this.acceptedTypes !== undefined && this.acceptedTypes.equals(new HashedSet<string>(expected.values()));
        }
    }

    validateAcceptedElements(expected?: Array<any>): boolean {
        if (expected === undefined || expected.length === 0) {
            return this.acceptedElementHashes === undefined;
        } else {
            const expectedSet = new HashedSet(expected.map((v: any) => HashedObject.hashElement(v)).values());
            return this.acceptedElementHashes !== undefined && this.acceptedElementHashes.equals(expectedSet);
        }
    }

    protected shouldAcceptElement(element: T) {

        if (this.acceptedElementHashes !== undefined && !this.acceptedElementHashes.has(HashedObject.hashElement(element))) {
            return false;
        }

        if (this.acceptedTypes !== undefined && 
              !(
                (element instanceof HashedObject && this.acceptedTypes.has(element.getClassName())) 
                        ||
                (!(element instanceof HashedObject) && this.acceptedTypes.has(typeof(element)))
               )
                
        ) {

            return false;

        }
    
        return true;
    }
}

abstract class CollectionOp<T> extends MutationOp {

    constructor(targetObject?: BaseCollection<T>) {
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

        const targetObject = this.getTargetObject() as BaseCollection<T>;
        const author = this.getAuthor();

        if (targetObject.writers !== undefined && (author === undefined || !targetObject.writers.has(author))) {
            return false;
        }

        return true;
    }
    
}

export { Collection, BaseCollection, CollectionOp };
export type { CollectionConfig };