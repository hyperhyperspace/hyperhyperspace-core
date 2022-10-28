import { MutableContentEvents } from '../../model/mutable/MutableObject';
import { HashedObject } from '../../model/immutable/HashedObject';
import { Hash } from '../../model/hashing/Hashing';
import { MutationOp } from 'data/model/mutable/MutationOp';
import { HashedSet } from 'data/model/immutable/HashedSet';
import { HashReference } from 'data/model/immutable/HashReference';
import { Logger, LogLevel } from 'util/logging';
import { MultiMap } from 'util/multimap';
import { ClassRegistry } from 'data/model';
import { BaseCollection, Collection, CollectionConfig, CollectionOp } from './Collection';
import { Identity } from 'data/identity';

type ElmtHash = Hash;

// a simple mutable set with an immutable set of authorized writers

enum MutableSetEvents {
    Add    = 'add',
    Delete = 'delete'
}

class AddOp<T> extends CollectionOp<T> {

    static className = 'hhs/v0/MutableSet/AddOp';

    element?: T;

    constructor(targetObject?: MutableSet<T>, element?: T, author?: Identity) {
        super(targetObject);

        if (element !== undefined) {
            this.element = element;
            this.setRandomId();

            if (author !== undefined) {
                this.setAuthor(author);
            }
        }   
    }

    getClassName() {
        return AddOp.className;
    }

    init() {
        super.init();
    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }

        const targetObject = this.getTargetObject();

        if (! (targetObject instanceof MutableSet)) {
            return false;
        }

        if (!(this.element instanceof HashedObject || HashedObject.isLiteral(this.element))) {
            return false;
        }

        return true;
    }
}

class DeleteOp<T> extends CollectionOp<T> {

    static className = 'hhs/v0/MutableSet/DeleteOp';

    elementHash? : Hash;
    deletedOps?  : HashedSet<HashReference<AddOp<T>>>;

    constructor(target?: MutableSet<T>, elementHash?: Hash, addOps?: IterableIterator<HashReference<AddOp<T>>>, author?: Identity) {
        super(target);

        this.elementHash = elementHash;

        if (addOps !== undefined) {
            this.deletedOps = new HashedSet();

            for (const addOp of addOps) {                
                if (addOp.className !== AddOp.className) {
                    throw new Error('Trying to create a delete op referencing an op that is not an addition op.');
                }

                this.deletedOps.add(addOp);
            }
        }

        if (author !== undefined) {
            this.setAuthor(author);
        }
    }

    init() {
        super.init();
    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }

        const targetObject = this.getTargetObject();

        if (! (targetObject instanceof MutableSet)) {
            return false;
        }

        if (this.elementHash === undefined) {
            
            MutableSet.logger.warning('The field elementHash of type MutableSet/DeleteOp is mandatory.')
            return false;
        }

        if (typeof this.elementHash !== 'string') {
            MutableSet.logger.warning('The field elementHash of type MutableSet/DeleteOp should be a string.')
            return false;
        }

        if (this.deletedOps === undefined) {
            MutableSet.logger.warning('The field deletedOps of type MutableSet/DeleteOp is mandatory');
            return false;
        }

        if (!(this.deletedOps instanceof HashedSet)) {
            MutableSet.logger.warning('The field deletedOps of type MutableSet/DeleteOp should be a HashedSet.');
            return false;
        }

        if (this.deletedOps.size() === 0) {
            MutableSet.logger.warning('The deletedOps set cannot be empty in a MutableSet/DeleteOp.');
            return false;
        }

        for (const ref of (this.deletedOps as HashedSet<HashReference<AddOp<T>>>).values()) {
            const op = references.get(ref.hash);

            if (op === undefined) {
                MutableSet.logger.warning('Addition op referenced in MutableSet deletion op is missing from references provided for validation.');
            }

            if (!(op instanceof AddOp)) {
                MutableSet.logger.warning('Addition op referenced in MutableSet deletion op has the wrong type in the references provided for validation.');
                return false;
            }

            if (!op.targetObject?.equals(this.targetObject)) {
                MutableSet.logger.warning('Addition op referenced in MutableSet deletion op points to a different set.');
                return false;
            }

            const addOp = op as AddOp<T>;

            if (HashedObject.hashElement(addOp.element) !== this.elementHash) {
                MutableSet.logger.warning('Addition op referenced in MutableSet deletion op contains an element whose hash does not match the one being deleted.');
                return false;
            }
        }


        return true;

    }

    getClassName() {
        return DeleteOp.className;
    }
    
}

class MutableSet<T> extends BaseCollection<T> implements Collection<T> {

    static className = 'hss/v0/MutableSet';
    static opClasses = [AddOp.className, DeleteOp.className];
    static logger    = new Logger(MutableSet.className, LogLevel.INFO);

    _logger: Logger;

    _elements: Map<ElmtHash, T>;
    _currentAddOpRefs: Map<ElmtHash, HashedSet<HashReference<AddOp<T>>>>;

    //_unsavedAppliedOps: Set<Hash>;

    /*_addElementCallback?    : (element: T) => void;
    _deleteElementCallback? : (element: T) => void;*/

    constructor(config?: CollectionConfig) {
        super(MutableSet.opClasses, config);

        this.setRandomId();

        this._logger = MutableSet.logger;

        this._elements = new Map();
        this._currentAddOpRefs = new Map();

        //this._unsavedAppliedOps = new Set();

    }

    init(): void {

    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!(await super.validate(references))) {
            return false;
        }

        return true;
    }

    shouldAcceptMutationOp(op: MutationOp, opReferences: Map<Hash, HashedObject>): boolean {

        if (!super.shouldAcceptMutationOp(op, opReferences)) {
            return false;
        }

        if (op instanceof AddOp && !this.shouldAcceptElement(op.element as T)) {
            return false;
        }

        return true;
    }

    async add(element: T) {

        if (!(element instanceof HashedObject)) {
            if (!HashedObject.isLiteral(element)) {
                throw new Error('MutableSets can contain either a class deriving from HashedObject or a pure literal (a constant, without any HashedObjects within).');
            }
        }

        let op = new AddOp(this, element);
        await this.applyNewOp(op);
    }

    async delete(element: T) {
        return await this.deleteByHash(HashedObject.hashElement(element));
    }

    async deleteByHash(hash: Hash): Promise<boolean> {
        let addOpRefs = this._currentAddOpRefs.get(hash);

        if (addOpRefs !== undefined  && addOpRefs.size() > 0) {
            let op = new DeleteOp(this, hash, addOpRefs.values());
            await this.applyNewOp(op);
            return true;
        } else {
            return false;
        }
    }

    has(element: T) {
        return this.hasByHash(HashedObject.hashElement(element));
    }

    hasByHash(hash: Hash) {
        return this._elements.get(hash) !== undefined;
    }

    get(hash: Hash) : T | undefined {
        return this._elements.get(hash);
    }

    size() {
        return this._elements.size;
    }

    values() {
        return this._elements.values();
    }

    valueHashes() {
        return this._elements.keys();
    }

    mutate(op: MutationOp): Promise<boolean> {

        let mutated = false;

        if (op instanceof AddOp ) {
            const addOp = op as AddOp<T>;

            let hash = HashedObject.hashElement(op.element);

            if (hash === undefined) {
                throw new Error('Trying to add an element to set, but the element is undefined.');
            }

            let current = this._currentAddOpRefs.get(hash);

            if (current === undefined) {
                current = new HashedSet();
                this._currentAddOpRefs.set(hash, current);
            }

            mutated = current.size() === 0;

            current.add(addOp.createReference());

            

            if (mutated) {
                this._elements.set(hash, addOp.element as T);
                this._mutationEventSource?.emit({emitter: this, action: MutableSetEvents.Add, data: addOp.element});
                if (addOp.element instanceof HashedObject) {
                    this._mutationEventSource?.emit({emitter: this, action: MutableContentEvents.AddObject, data: addOp.element});
                }
                
                /*if (this._addElementCallback !== undefined) {
                    try {
                        this._addElementCallback(addOp.element as T);
                    } catch (e) {
                        this._logger.warning(() => ('Error calling MutableSet element addition callback on op ' + addOp.hash()));
                    }
                }*/
            }


        } else if (op instanceof DeleteOp) {
            const deleteOp = op as DeleteOp<T>;

            let hash = deleteOp.elementHash;

            if (hash === undefined) {
                throw new Error('Trying to remove an element from set, but elementHash is undefined.');
            }

            let current = this._currentAddOpRefs.get(hash);

            if (current !== undefined) {
                if (deleteOp.deletedOps !== undefined) {
                    for (const opRef of deleteOp.deletedOps.values()) {
                        current.remove(opRef);
                    }
                }

                if (current.size() === 0) {
                    mutated = true;
                    const deleted = this._elements.get(hash) as T;
                    this._elements.delete(hash);
                    this._currentAddOpRefs.delete(hash);
                    this._mutationEventSource?.emit({emitter: this, action: MutableSetEvents.Delete, data: deleted});
                    if (deleted instanceof HashedObject) {
                        this._mutationEventSource?.emit({emitter: this, action: MutableContentEvents.RemoveObject, data: deleted});
                    }
                    /*if (this._deleteElementCallback !== undefined) {
                        try {
                            this._deleteElementCallback(deleted);
                        } catch (e) {
                            this._logger.warning(() => ('Error calling MutableSet element deletion callback on op ' + deleteOp.hash()));
                        }
                    }*/
                }
            }

        } else {
            throw new Error('Invalid op type for MutableSet:' + op?.getClassName());
        }

        return Promise.resolve(mutated);
    }

    getMutableContents(): MultiMap<Hash, HashedObject> {
        const contents = new MultiMap<Hash, HashedObject>();

        for (const [hash, elmt] of this._elements) {
            if (elmt instanceof HashedObject) {
                contents.add(hash, elmt);
            }
        }

        return contents;
    }

    getMutableContentByHash(hash: Hash): Set<HashedObject> {

        const found = new Set<HashedObject>();

        const elmt = this._elements.get(hash);

        if (elmt instanceof HashedObject) {
            found.add(elmt);
        }

        return found;
    }

    /*onAddition(callback: (elem: T) => void) {
        this._addElementCallback = callback;
    }

    onDeletion(callback: (elem: T) => void) {
        this._deleteElementCallback = callback;
    }*/
    
    getClassName(): string {
        return MutableSet.className;
    }
}

ClassRegistry.register(DeleteOp.className, DeleteOp);
ClassRegistry.register(AddOp.className, AddOp);
ClassRegistry.register(MutableSet.className, MutableSet);


export { MutableSet, AddOp as MutableSetAddOp, DeleteOp as MutableSetDeleteOp, MutableSetEvents };