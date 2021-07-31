import { MutableObject } from '../model/MutableObject';
import { HashedObject } from '../model/HashedObject';
import { Hash } from 'data/model/Hashing';
import { MutationOp } from 'data/model/MutationOp';
import { HashedSet } from 'data/model/HashedSet';
import { HashReference } from 'data/model/HashReference';
import { Types } from './Types';
import { Logger, LogLevel } from 'util/logging';

type ElmtHash = Hash;

// a simple mutable set with a single writer

abstract class MutableSetOp<T extends HashedObject> extends MutationOp {

    constructor(target?: MutableSet<T>) {
        super(target);

        if (target !== undefined) {
            let author = target.getAuthor();
            if (author !== undefined) {
                this.setAuthor(author);
            }
        }
    }

    init(): void {

    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }

        if (! (this.getTargetObject() instanceof MutableSet)) {
            return false;
            //throw new Error('MutableSetOp.target must be a MutableSet, got a ' + this.getTarget().getClassName() + ' instead.');
        }

        if (this.getTargetObject().getAuthor() !== undefined && !(this.getTargetObject().getAuthor()?.equals(this.getAuthor()))) {
            return false;
            //throw new Error('MutableSetOp has author ' + this.getAuthor()?.hash() + ' but points to a target authored by ' + this.getTarget().getAuthor()?.hash() + '.');
        }

        return true;
    }
    
}

class MutableSetAddOp<T extends HashedObject> extends MutableSetOp<T> {

    static className = 'hhs/v0/MutableSetAddOp';

    element?: T;

    constructor(target?: MutableSet<T>, element?: T) {
        super(target);

        if (element !== undefined) {
            this.element = element;
            this.setRandomId();
        }   
    }

    getClassName() {
        return MutableSetAddOp.className;
    }

    init() {
        super.init();
    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }

        const constraints = (this.getTargetObject() as MutableSet<T>).typeConstraints;

        if (!Types.satisfies(this.element, constraints)) {
            return false;
            //throw new Error('MutableSetAddOp contains a value with an unexpected type.')
        }

        return true;
    }
}

MutableSetAddOp.registerClass(MutableSetAddOp.className, MutableSetAddOp);

class MutableSetDeleteOp<T extends HashedObject> extends MutableSetOp<T> {

    static className = 'hhs/v0/MutableSetDeleteOp';

    elementHash? : Hash;
    deletedOps?  : HashedSet<HashReference<MutableSetAddOp<T>>>;

    constructor(target?: MutableSet<T>, elementHash?: Hash, addOps?: IterableIterator<HashReference<MutableSetAddOp<T>>>) {
        super(target);

        this.elementHash = elementHash;

        if (addOps !== undefined) {
            this.deletedOps = new HashedSet();

            for (const addOp of addOps) {                
                if (addOp.className !== MutableSetAddOp.className) {
                    throw new Error('Trying to create a delete op referencing an op that is not an addition op.');
                }

                this.deletedOps.add(addOp);
            }
        }
    }

    // need a valid() function, that is called only when an object is NEW and we don't yet
    // trust its integrity. init() will be called every time it is loaded (after all the
    // fields have been filled in, either by the constructor or by the deliteralization
    // mechanism, and after valid, if it is untrusted)
    
    // valid needs all the references also, already validated, to do its checks.

    // (all this follows from the need to validate deletedOps)

    init() {

        super.init();

    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }


        if (this.elementHash === undefined) {
            
            MutableSet.logger.warning('The field elementHash of type MutableSetDeletOp is mandatory.')
            return false;
        }

        if (typeof this.elementHash !== 'string') {
            MutableSet.logger.warning('The field elementHash of type MutebleSetDeleteOp should be a string.')
            return false;
        }

        if (this.deletedOps === undefined) {
            MutableSet.logger.warning('The field deletedOps of type MutableSetDeleteOp is mandatory');
            return false;
        }

        if (!(this.deletedOps instanceof HashedSet)) {
            MutableSet.logger.warning('The field deletedOps of type MutableSetDeleteOp should be a HashedSet.');
            return false;
        }

        for (const ref of (this.deletedOps as HashedSet<HashReference<MutableSetAddOp<T>>>).values()) {
            const op = references.get(ref.hash);

            if (op === undefined) {
                MutableSet.logger.warning('Addition op referenced in MutableSet deletion op is missing from references provided for validation.');
            }

            if (!(op instanceof MutableSetAddOp)) {
                MutableSet.logger.warning('Addition op referenced in MutableSet deletion op has the wrong type in the references provided for validation.');
                return false;
            }

            if (!op.targetObject?.equals(this.targetObject)) {
                MutableSet.logger.warning('Addition op referenced in MutableSet deletion op points to a different set.');
                return false;
            }

            const addOp = op as MutableSetAddOp<T>;

            if (addOp.element?.hash() !== this.elementHash) {
                MutableSet.logger.warning('Addition op referenced in MutableSet deletion op contains an element whose hash does not match the one being deleted.');
                return false;
            }
        }


        return true;

    }

    getClassName() {
        return MutableSetDeleteOp.className;
    }
    
}

MutableSetDeleteOp.registerClass(MutableSetDeleteOp.className, MutableSetDeleteOp);

class MutableSet<T extends HashedObject> extends MutableObject {

    static className = 'hss/v0/MutableSet';
    static opClasses = [MutableSetAddOp.className, MutableSetDeleteOp.className];
    static logger    = new Logger(MutableSet.className, LogLevel.INFO);

    _logger: Logger;

    typeConstraints?: Array<string>;

    _elements: Map<ElmtHash, T>;
    _currentAddOpRefs: Map<ElmtHash, HashedSet<HashReference<T>>>;

    _unsavedAppliedOps: Set<Hash>;

    _addElementCallback?    : (element: T) => void;
    _deleteElementCallback? : (element: T) => void;

    constructor() {
        super(MutableSet.opClasses);

        this._logger = MutableSet.logger;

        this.setRandomId();

        this._elements = new Map();
        this._currentAddOpRefs = new Map();

        this._unsavedAppliedOps = new Set();

    }

    init(): void {

    }

    async validate(references: Map<Hash, HashedObject>) {
        references;
        return Types.isTypeConstraint(this.typeConstraints);
    }

    async add(element: T) {
        let op = new MutableSetAddOp(this, element);
        await this.applyNewOp(op);
    }

    async delete(element: T) {
        return await this.deleteByHash(element.hash());
    }

    async deleteByHash(hash: Hash): Promise<boolean> {
        let addOpRefs = this._currentAddOpRefs.get(hash);

        if (addOpRefs !== undefined  && addOpRefs.size() > 0) {
            let op = new MutableSetDeleteOp(this, hash, addOpRefs.values());
            await this.applyNewOp(op);
            return true;
        } else {
            return false;
        }
    }

    has(element: T) {
        return this.hasByHash(element.hash());
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

    mutate(op: MutationOp, isNew: boolean): Promise<boolean> {

        let mutated = false;

        if (op instanceof MutableSetAddOp ) {
            const addOp = op as MutableSetAddOp<T>;

            let hash = op.element.hash();

            if (hash === undefined) {
                throw new Error('Trying to add an element to set, but the element is undefined.');
            }

            let current = this._currentAddOpRefs.get(hash);

            if (current === undefined) {
                current = new HashedSet();
                this._currentAddOpRefs.set(hash, current);
            }

            current.add(addOp.createReference());

            this._elements.set(hash, addOp.element as T)

            if (isNew) {
                this._unsavedAppliedOps.add(op.hash());
                mutated = true;
            } else {
                const opHash = addOp.hash();
                if (!this._unsavedAppliedOps.has(opHash)) {
                    mutated = true;
                } else {
                    this._unsavedAppliedOps.delete(opHash);
                }
            }

            if (mutated) {
                if (this._addElementCallback !== undefined) {
                    try {
                        this._addElementCallback(addOp.element as T);
                    } catch (e) {
                        this._logger.warning(() => ('Error calling MutableSet element addition callback on op ' + addOp.hash()));
                    }
                }
            }


        } else if (op instanceof MutableSetDeleteOp) {
            const deleteOp = op as MutableSetDeleteOp<T>;

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
                    if (this._deleteElementCallback !== undefined) {
                        try {
                            this._deleteElementCallback(deleted);
                        } catch (e) {
                            this._logger.warning(() => ('Error calling MutableSet element deletion callback on op ' + deleteOp.hash()));
                        }
                    }
                }
            }

        } else {
            throw new Error("Method not implemented.");
        }

        return Promise.resolve(mutated);
    }

    onAddition(callback: (elem: T) => void) {
        this._addElementCallback = callback;
    }

    onDeletion(callback: (elem: T) => void) {
        this._deleteElementCallback = callback;
    }
    
    getClassName(): string {
        return MutableSet.className;
    }

}

MutableSet.registerClass(MutableSet.className, MutableSet);


export { MutableSet };