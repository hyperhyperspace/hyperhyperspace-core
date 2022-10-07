import { HashedObject, HashedSet } from '../../model/immutable';
import { MutableObject, MutableObjectConfig, MutationOp } from '../../model/mutable';
import { Identity } from '../../identity';
import { Hash} from '../../model/hashing'
import { Authorization, Authorizer } from 'data/model';

interface CausalCollection<T> {
    has(elmt: T): boolean;
    hasByHash(hash: Hash): boolean;

    attestMembershipForOp(elmt: T, op: MutationOp): Promise<boolean>;
    attestMembershipForOpByHash(hash: Hash, op: MutationOp): Promise<boolean>;

    verifyMembershipAttestationForOp(elmt: T, op: MutationOp, usedKeys: Set<string>): boolean;

    createMembershipAuthorizer(elmt: T): Authorizer;
}

type CausalCollectionConfig = {
    writer?: Identity, // just for convenience, "writer: A" is equiv. to "writers: [A]"
    writers?: IterableIterator<Identity>,
    mutableWriters?: CausalCollection<Identity>,
    acceptedTypes?: Array<string>,
    acceptedElements?: Array<any>
};

abstract class BaseCausalCollection<T> extends MutableObject {
    
    // The collection has both an immutable set and a mutable causal collection of authorized writers:
    writers?        : HashedSet<Identity>;
    mutableWriters? : CausalCollection<Identity>;

    // For someone to have write access they must either be in the immutable set, or attest that they 
    // belong to the causal collection of writers. If both are missing, then the writing permissions
    // have no effect, and anyone can write.

    acceptedTypes?: HashedSet<string>;
    acceptedElementHashes?: HashedSet<Hash>;

    constructor(acceptedOpClasses : Array<string>, config?: MutableObjectConfig & CausalCollectionConfig) {
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

        if (config?.mutableWriters !== undefined) {
            this.mutableWriters = config?.mutableWriters;
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

    // Note: since mutableWriters may be any implementation of CausalCollection,
    //       we cannot check its integrity here. The app should check that it is
    //       the right collection if it is present anyway.

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

    hasSingleWriter() {
        return this.writers !== undefined && this.writers.size() === 1 && this.mutableWriters === undefined;
    }

    // throws if there isn't exactly one writer
    getSingleWriter() {
       if (this.writers === undefined)  {
           return undefined;
       } else if (this.writers.size() > 1 || this.mutableWriters !== undefined) {
           throw new Error('Called getWriter() on a collection, but it has more than one writer');
       } else {
           return this.writers.values().next().value;
       }
    }

    getWriters() {
        return this.writers;
    }

    hasWriters() {
        return this.writers !== undefined;
    }

    hasWriterSet() {
        return this.mutableWriters !== undefined;
    }

    hasMutableWriters() {
        return this.mutableWriters !== undefined;
    }

    getMutableWriters(): CausalCollection<Identity> {

        if (!this.hasMutableWriters()) {
            throw new Error('This collections has no mutable writers')
        }

        return this.mutableWriters as CausalCollection<Identity>;
    }

    protected createWriteAuthorizer(author?: Identity): Authorizer {

        if (this.writers === undefined && this.mutableWriters === undefined) {
            return Authorization.always;
        } else if (this.writers !== undefined && author !== undefined && this.writers.has(author)) {
            return Authorization.always;
        } else if (this.mutableWriters !== undefined && author !== undefined) { 
            return this.mutableWriters.createMembershipAuthorizer(author);
        } else {
            return Authorization.never;
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

abstract class CausalCollectionOp extends MutationOp {

    static setSingleAuthorIfNecessary(op: MutationOp) {

        const targetObject = op.getTargetObject();

        if (targetObject instanceof BaseCausalCollection) {
            if (targetObject.hasSingleWriter()) {
                op.setAuthor(targetObject.getSingleWriter());
            }
        }

    }
}

export { CausalCollection, BaseCausalCollection, CausalCollectionOp };
export type { CausalCollectionConfig };