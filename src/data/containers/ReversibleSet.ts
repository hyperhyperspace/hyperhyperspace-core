import { MutableObject } from '../model/MutableObject';
import { HashedObject } from '../model/HashedObject';
import { Hash } from 'data/model/Hashing';
import { MutationOp } from 'data/model/MutationOp';
import { HashedSet } from 'data/model/HashedSet';
import { HashReference } from 'data/model/HashReference';
import { Types } from './Types';
import { Logger, LogLevel } from 'util/logging';
import { MultiMap } from 'util/multimap';

type ElmtHash     = Hash;
type AddOpHash    = Hash;
type DeleteOpHash = Hash;

// a simple mutable set with a single writer

abstract class ReversibleSetOp<T extends HashedObject> extends MutationOp {

    constructor(target?: ReversibleSet<T>, causalOps?: IterableIterator<MutationOp>) {
        super(target);

        if (target !== undefined) {
            let author = target.getAuthor();
            if (author !== undefined) {
                this.setAuthor(author);
            }

            if (causalOps !== undefined) {
                this.setCausalOps(causalOps);
            }
        }
    }

    init(): void {

    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }

        if (! (this.getTargetObject() instanceof ReversibleSet)) {
            return false;
            //throw new Error('ReversibleSetOp.target must be a ReversibleSet, got a ' + this.getTarget().getClassName() + ' instead.');
        }

        if (this.getTargetObject().getAuthor() !== undefined && !(this.getTargetObject().getAuthor()?.equals(this.getAuthor()))) {
            return false;
            //throw new Error('ReversibleSetOp has author ' + this.getAuthor()?.hash() + ' but points to a target authored by ' + this.getTarget().getAuthor()?.hash() + '.');
        }

        return true;
    }
    
}

class ReversibleSetAddOp<T extends HashedObject> extends ReversibleSetOp<T> {

    static className = 'hhs/v0/ReversibleSetAddOp';

    element?: T;

    constructor(target?: ReversibleSet<T>, element?: T, causalOps?: IterableIterator<MutationOp>) {
        super(target, causalOps);

        if (element !== undefined) {
            this.element = element;
            this.setRandomId();
        }   
    }

    getClassName() {
        return ReversibleSetAddOp.className;
    }

    init() {
        super.init();
    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }

        const constraints = (this.getTargetObject() as ReversibleSet<T>).typeConstraints;

        if (!Types.satisfies(this.element, constraints)) {
            return false;
            //throw new Error('ReversibleSetAddOp contains a value with an unexpected type.')
        }

        return true;
    }
}



class ReversibleSetDeleteOp<T extends HashedObject> extends ReversibleSetOp<T> {

    static className = 'hhs/v0/ReversibleSetDeleteOp';

    elementHash? : Hash;
    deletedOps?  : HashedSet<HashReference<ReversibleSetAddOp<T>>>;

    constructor(target?: ReversibleSet<T>, elementHash?: Hash, addOps?: IterableIterator<HashReference<ReversibleSetAddOp<T>>>, causalOps?: IterableIterator<MutationOp>) {
        super(target, causalOps);

        this.elementHash = elementHash;

        if (addOps !== undefined) {
            this.deletedOps = new HashedSet();

            for (const addOp of addOps) {                
                if (addOp.className !== ReversibleSetAddOp.className) {
                    throw new Error('Trying to create a delete op referencing an op that is not an addition op.');
                }

                this.deletedOps.add(addOp);
            }
        }
    }

    init() {

        super.init();

    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }


        if (this.elementHash === undefined) {
            
            ReversibleSet.logger.warning('The field elementHash of type ReversibleSetDeletOp is mandatory.')
            return false;
        }

        if (typeof this.elementHash !== 'string') {
            ReversibleSet.logger.warning('The field elementHash of type ReversibleSetDeleteOp should be a string.')
            return false;
        }

        if (this.deletedOps === undefined) {
            ReversibleSet.logger.warning('The field deletedOps of type ReversibleSetDeleteOp is mandatory');
            return false;
        }

        if (!(this.deletedOps instanceof HashedSet)) {
            ReversibleSet.logger.warning('The field deletedOps of type ReversibleSetDeleteOp should be a HashedSet.');
            return false;
        }

        for (const ref of (this.deletedOps as HashedSet<HashReference<ReversibleSetAddOp<T>>>).values()) {
            const op = references.get(ref.hash);

            if (op === undefined) {
                ReversibleSet.logger.warning('Addition op referenced in ReversibleSet deletion op is missing from references provided for validation.');
            }

            if (!(op instanceof ReversibleSetAddOp)) {
                ReversibleSet.logger.warning('Addition op referenced in ReversibleSet deletion op has the wrong type in the references provided for validation.');
                return false;
            }

            if (!op.targetObject?.equals(this.targetObject)) {
                ReversibleSet.logger.warning('Addition op referenced in ReversibleSet deletion op points to a different set.');
                return false;
            }

            const addOp = op as ReversibleSetAddOp<T>;

            if (addOp.element?.hash() !== this.elementHash) {
                ReversibleSet.logger.warning('Addition op referenced in ReversibleSet deletion op contains an element whose hash does not match the one being deleted.');
                return false;
            }
        }


        return true;

    }

    getClassName() {
        return ReversibleSetDeleteOp.className;
    }
    
}

class ReversibleSet<T extends HashedObject> extends MutableObject {

    static className = 'hss/v0/ReversibleSet';
    static opClasses = [ReversibleSetAddOp.className, ReversibleSetDeleteOp.className];
    static logger    = new Logger(ReversibleSet.className, LogLevel.INFO);

    _logger: Logger;

    typeConstraints?: Array<string>;

    _elements: Map<ElmtHash, T>;
    _currentAddOpRefs: MultiMap<ElmtHash, AddOpHash>;
    _currentDeleteOpRefs: MultiMap<AddOpHash, DeleteOpHash>;

    //_unsavedAppliedOps: Set<Hash>;

    _addElementCallback?    : (element: T) => void;
    _deleteElementCallback? : (element: T) => void;

    constructor() {
        super(ReversibleSet.opClasses, true);

        this._logger = ReversibleSet.logger;

        this.setRandomId();

        this._elements = new Map();
        this._currentAddOpRefs = new MultiMap();
        this._currentDeleteOpRefs = new MultiMap();

        //this._unsavedAppliedOps = new Set();

    }

    init(): void {

    }

    async validate(references: Map<Hash, HashedObject>) {
        references;
        return Types.isTypeConstraint(this.typeConstraints);
    }

    async add(element: T, causalOps?: IterableIterator<MutationOp>) {
        let op = new ReversibleSetAddOp(this, element, causalOps);
        await this.applyNewOp(op);
    }

    async delete(element: T, causalOps?: IterableIterator<MutationOp>) {
        return this.deleteByHash(element.hash(), causalOps);
    }

    async deleteByHash(hash: Hash, causalOps?: IterableIterator<MutationOp>): Promise<boolean> {
        let addOpRefs = this._currentAddOpRefs.get(hash);

        if (addOpRefs !== undefined  && addOpRefs.size > 0) {
            let toDelete = new Set<HashReference<ReversibleSetAddOp<T>>>();
            for (const hash of addOpRefs.values()) {
                toDelete.add(new HashReference(hash, ReversibleSetAddOp.className));
            }
            let op = new ReversibleSetDeleteOp(this, hash, toDelete.values(), causalOps);
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

    mutate(op: MutationOp): Promise<boolean> {
        return this.mutateWithInvalidation(op, true);
    }

    undo(op: MutationOp): Promise<boolean> {
        return this.mutateWithInvalidation(op, false)
    }

    redo(op: MutationOp): Promise<boolean> {
        return this.mutateWithInvalidation(op, true);
    }

    mutateWithInvalidation(op: ReversibleSetOp<T>, valid: boolean) {
        //let mutated = false;

        let elmtHash: Hash;
        let wasPresent: boolean;
        let isPresent: boolean;

        if (op instanceof ReversibleSetAddOp ) {
            const addOp = op as ReversibleSetAddOp<T>;

            elmtHash  = (op.element as T).hash() as Hash;
            wasPresent = this._currentAddOpRefs.hasKey(elmtHash);

            const addOpHash = op.hash();

            const canAdd     = !this._currentDeleteOpRefs.hasKey(addOpHash);

            if (valid && canAdd) {
                this._currentAddOpRefs.add(elmtHash, addOpHash);
                this._elements.set(elmtHash, addOp.element as T)
            }

            isPresent = this._currentAddOpRefs.hasKey(elmtHash);


        } else if (op instanceof ReversibleSetDeleteOp) {

            const deleteOpHash = op.hash();
            elmtHash     = op.elementHash as Hash;

            wasPresent = this._currentAddOpRefs.hasKey(elmtHash);
            
            for (const addOpRef of (op.deletedOps as HashedSet<HashReference<ReversibleSetAddOp<T>>>).values()) {
                const addOpHash = addOpRef.hash;

                if (valid) {
                    this._currentDeleteOpRefs.add(addOpHash, deleteOpHash);
                } else {
                    this._currentDeleteOpRefs.delete(addOpHash, deleteOpHash);
                }

                if (this._currentDeleteOpRefs.hasKey(addOpHash)) {
                    this._currentAddOpRefs.delete(elmtHash, addOpHash);
                } else {
                    this._currentAddOpRefs.add(elmtHash, addOpHash);
                }

            }

            isPresent = this._currentAddOpRefs.hasKey(elmtHash);

            if (!isPresent) {
                this._elements.delete(elmtHash);
            }

        } else {
            throw new Error("Method not implemented.");
        }

        const mutated = wasPresent !== isPresent;

        if (mutated) {
            const elmt = this._elements.get(elmtHash) as T;

            if (isPresent) {
                if (this._addElementCallback !== undefined) {
                    try {
                        this._addElementCallback(elmt);
                    } catch (e) {
                        this._logger.warning(() => ('Error calling ReversibleSet element addition callback on op ' + op.hash()));
                    }
                }    
            } else {
                if (this._deleteElementCallback !== undefined) {
                    try {
                        this._deleteElementCallback(elmt);
                    } catch (e) {
                        this._logger.warning(() => ('Error calling ReversibleSet element deletion callback on op ' + op.hash()));
                    }
                }
            }
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
        return ReversibleSet.className;
    }

}

HashedObject.registerClass(ReversibleSetDeleteOp.className, ReversibleSetDeleteOp);
HashedObject.registerClass(ReversibleSetAddOp.className, ReversibleSetAddOp);
HashedObject.registerClass(ReversibleSet.className, ReversibleSet);


export { ReversibleSet };