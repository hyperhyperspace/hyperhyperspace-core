import { Hash } from '../../model/hashing';
import { HashedObject, HashedSet, HashReference } from '../../model/immutable';
import { MutationOp } from '../../model/mutable';
import { MutableObject } from '../../model';

import {Ordinal, Ordinals, DenseOrder } from 'util/ordinals';
import { DedupMultiMap } from 'util/dedupmultimap';
import { Logger, LogLevel } from 'util/logging';
import { ArrayMap } from 'util/arraymap';
import { Types } from 'data/collections';

// a simple mutable list with a single writer

// can work with or without duplicates (in the latter, inserting an element already in the set has no)

abstract class MutableArrayOp<T> extends MutationOp {

    constructor(target?: MutableArray<T>) {
        super(target);

        if (target !== undefined) {
            let author = target.getAuthor();
            if (author !== undefined) {
                this.setAuthor(author);
            }
        }
    }

    init(): void {
        throw new Error('Method not implemented.');
    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }

        if (! (this.getTargetObject() instanceof MutableArray)) {
            return false;
        }

        if (this.getTargetObject().getAuthor() !== undefined && !(this.getTargetObject().getAuthor()?.equals(this.getAuthor()))) {
            return false;
        }

        return true;
    }
    
}

class InsertOp<T> extends MutableArrayOp<T> {

    static className = 'hhs/v0/MutableArray/InsertOp';

    element?: T;
    ordinal?: Ordinal;

    constructor(target?: MutableArray<T>, element?: T, ordinal?: Ordinal) {
        super(target);

        this.element = element;
        this.ordinal = ordinal;
    }

    getClassName(): string {
        return InsertOp.className;
    }

    init(): void {
        super.init();
    }
    
    async validate(references: Map<Hash, HashedObject>) {
        if (!await super.validate(references)) {
            return false;
        }

        if (this.element === undefined || !((this.element instanceof HashedObject) || HashedObject.isLiteral(this.element))) {
            return false;
        }

        if (this.ordinal === undefined || !Ordinals.isOrdinal(this.ordinal)) {
            return false;
        }

        const constraints = (this.getTargetObject() as MutableArray<T>).typeConstraints;

        if (!Types.satisfies(this.element, constraints)) {
            return false;            
        }

        return true;
    }
}

class DeleteOp<T> extends MutableArrayOp<T> {

    static className = 'hhs/v0/MutableArray/DeleteOp';

    elementHash?: Hash;
    deletedOps?: HashedSet<HashReference<InsertOp<T>>>;

    constructor(target?: MutableArray<T>, elementHash?: Hash, insertOps?: IterableIterator<HashReference<InsertOp<T>>>) {
        super(target);

        this.elementHash = elementHash;

        if (insertOps !== undefined) {
            this.deletedOps = new HashedSet();
            
            for (const insertOp of insertOps) {
                if (insertOp.className !== InsertOp.className) {
                    throw new Error('Trying to create a delete op referencing an op that is not an insertion op.');
                }

                this.deletedOps.add(insertOp);
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
            
            MutableArray.logger.warning('The field elementHash of type MutableArray/DeletOp is mandatory.')
            return false;
        }

        if (typeof this.elementHash !== 'string') {
            MutableArray.logger.warning('The field elementHash of type MutableArray/DeleteOp should be a string.')
            return false;
        }

        if (this.deletedOps === undefined) {
            MutableArray.logger.warning('The field deletedOps of type MutableArray/DeleteOp is mandatory');
            return false;
        }

        if (!(this.deletedOps instanceof HashedSet)) {
            MutableArray.logger.warning('The field deletedOps of type MutableArray/DeleteOp should be a HashedSet.');
            return false;
        }

        if (this.deletedOps.size() === 0) {
            MutableArray.logger.warning('The deletedOps set cannot be empty in a MutableArray/DeleteOp.');
            return false;
        }

        for (const ref of (this.deletedOps as HashedSet<HashReference<InsertOp<T>>>).values()) {
            const op = references.get(ref.hash);

            if (op === undefined) {
                MutableArray.logger.warning('Addition op referenced in MutableArray deletion op is missing from references provided for validation.');
            }

            if (!(op instanceof InsertOp)) {
                MutableArray.logger.warning('Addition op referenced in MutableArray deletion op has the wrong type in the references provided for validation.');
                return false;
            }

            if (!op.targetObject?.equals(this.targetObject)) {
                MutableArray.logger.warning('Addition op referenced in MutableArray deletion op points to a different set.');
                return false;
            }

            const insertOp = op as InsertOp<T>;

            if (HashedObject.hashElement(insertOp.element) !== this.elementHash) {
                MutableArray.logger.warning('Insertion op referenced in MutableArray deletion op contains an element whose hash does not match the one being deleted.');
                return false;
            }
        }


        return true;

    }

    getClassName(): string {
        return DeleteOp.className;
    }
    
}

class MutableArray<T> extends MutableObject {

    static className = 'hhs/v0/MutableArray';
    static opClasses = [InsertOp.className, DeleteOp.className];
    static logger    = new Logger(MutableArray.className, LogLevel.INFO);
    

    duplicates: boolean;
    typeConstraints?: Array<string>;

    _elementsPerOrdinal: ArrayMap<Ordinal, Hash>;
    _ordinalsPerElement: ArrayMap<Hash, Ordinal>;
    _elements: Map<Hash, T>;

    _currentInsertOpRefs : DedupMultiMap<Hash, HashReference<InsertOp<T>>>;
    _currentInsertOpOrds : Map<Hash, Ordinal>;

    _needToRebuild: boolean;

    _contents : Array<T>;
    _hashes   : Array<Hash>;
    _ordinals : Array<Ordinal>;

    constructor(duplicates=true) {
        super([InsertOp.className, DeleteOp.className]);

        this.duplicates = duplicates;
        this.setRandomId();

        this._elementsPerOrdinal = new ArrayMap();
        this._ordinalsPerElement = new ArrayMap();
        this._elements = new Map();

        this._currentInsertOpRefs = new DedupMultiMap();
        this._currentInsertOpOrds = new Map();

        this._needToRebuild = false;
        this._contents = [];
        this._hashes   = [];
        this._ordinals = [];
    }

    async insertAt(element: T, idx: number) {
        await this.insertManyAt([element], idx);
    }

    async insertManyAt(elements: T[], idx: number) {
        this.rebuild();

        let after  : Ordinal|undefined = undefined;
        let before : Ordinal|undefined = undefined;
        

        if (0 < idx && idx <= this._hashes.length) {
            after = this._ordinals[idx-1];
        }

        if (idx < this._hashes.length) {
            before = this._ordinals[idx];
        }

        let first = true;

        for (const element of elements) {

            const elementHash = HashedObject.hashElement(element);
            const ordinal = DenseOrder.between(after, before);

            let oldInsertionOps: Set<HashReference<InsertOp<T>>>|undefined;

            if (!this.duplicates && first) {
                oldInsertionOps = this._currentInsertOpRefs.get(elementHash);
            }

            const insertOp = new InsertOp(this, element, ordinal);
            await this.applyNewOp(insertOp);

            // Note: in the "no duplciates" case, the delete -if necessary- has to come after the 
            // insert (taking care to exclude the newly inserted element). Then, if the new position
            // comes after the old one, the insert will initially have no effect, and the element 
            // will "move" to there after the delete. Hence the size of the list will never decrease,
            // and from the outside it will look like the element was just repositioned.

            if (oldInsertionOps !== undefined) {
                const deleteOp = new DeleteOp(this, elementHash, oldInsertionOps.values());
                await this.applyNewOp(deleteOp);
            }

            after = ordinal;
            first = false;
        }
    }

    async deleteAt(idx: number) {
        await this.deleteManyAt(idx, 1);
    }

    async deleteManyAt(idx: number, count: number) {
        this.rebuild();

        while (idx < this._contents.length && count > 0) {
            let hash = this._hashes[idx];

            if (this.duplicates) {
                await this.delete(hash, this._ordinals[idx]);
            } else {
                await this.delete(hash);
            }

            idx = idx + 1;
            count = count - 1;
        }
    }

    async deleteElement(element: T) {
        this.deleteElementByHash(HashedObject.hashElement(element));
    }

    async deleteElementByHash(hash: Hash) {
        this.rebuild();
        this.delete(hash);
    }

    async push(element: T) {
        await this.insertAt(element, this._contents.length);
    }

    async pop(): Promise<T> {
        this.rebuild();
        const lastIdx = this._contents.length - 1;
        const last = this._contents[lastIdx];
        await this.deleteAt(lastIdx);

        return last;
    }

    async concat(elements: T[]) {
        this.rebuild();
        await this.insertManyAt(elements, this._contents.length);
    }

    contents() {
        this.rebuild();
        return Array.from(this._contents);
    }

    lookup(idx: number) {
        this.rebuild();
        return this._contents[idx];
    }

    lookupHash(idx: number) {
        this.rebuild();
        return this._hashes[idx];
    }

    indexOf(element: T) {
        return this.indexOfByHash(HashedObject.hashElement(element));
    }

    indexOfByHash(hash: Hash) {
        this.rebuild();
        return this._hashes.indexOf(hash);
    }

    private async delete(hash: Hash, ordinal?: Ordinal) {

        let deleteOp: DeleteOp<T>|undefined = undefined;
        const insertOpRefs = this._currentInsertOpRefs.get(hash);

        if (ordinal !== undefined) {
            for (const insertOpRef of insertOpRefs.values()) {
                if (this._currentInsertOpOrds.get(insertOpRef.hash) === ordinal) {
                    deleteOp = new DeleteOp(this, hash, [insertOpRef].values());
                    break;
                }
            }
        } else {
            if (insertOpRefs.size > 0) {
                deleteOp = new DeleteOp(this, hash, insertOpRefs.values());
            }
        }

        if (deleteOp !== undefined) {
            await this.applyNewOp(deleteOp);
        }
    }

    async mutate(op: MutationOp): Promise<boolean> {

        const opHash = op.hash();

        if (op instanceof InsertOp) {

            const element = op.element as T;
            const ordinal = op.ordinal as Ordinal;

            const elementHash = HashedObject.hashElement(element);

            this._elementsPerOrdinal.add(ordinal, elementHash);
            this._ordinalsPerElement.add(elementHash, ordinal);

            this._elements.set(elementHash, element);

            let wasNotBefore = false;

            if (!this.duplicates && this._currentInsertOpRefs.get(elementHash).size === 0) {
                wasNotBefore = true;
            }

            this._currentInsertOpRefs.add(elementHash, op.createReference());
            this._currentInsertOpOrds.set(opHash, ordinal);

            if (this.duplicates || wasNotBefore) {
                this._mutationEventSource?.emit({emitter: this, action: 'insert', data: element});
            } else {
                this._mutationEventSource?.emit({emitter: this, action: 'move', data: element});
            }

            

            this._needToRebuild = true;

        } else if (op instanceof DeleteOp) {

            const elementHash = op.elementHash as Hash;
            const deletedOps = op.deletedOps as HashedSet<HashReference<DeleteOp<T>>>;
            
            let wasBefore = false;

            if (!this.duplicates && this._currentInsertOpRefs.get(elementHash).size > 0) {
                wasBefore = true;
            }

            let deletedOrdinal = false;

            for (const opRef of deletedOps.values()) {
                if (this._currentInsertOpRefs.delete(elementHash, opRef)) {
                    const ordinal = this._currentInsertOpOrds.get(opRef.hash) as Ordinal;
                    this._currentInsertOpOrds.delete(opRef.hash);

                    this._elementsPerOrdinal.delete(ordinal, elementHash);
                    this._ordinalsPerElement.delete(elementHash, ordinal);

                    deletedOrdinal = true;
                }
            }

            let current = this._currentInsertOpRefs.get(elementHash);

            const wasDeleted = current.size === 0; 
            if (wasDeleted) {
                this._elements.delete(elementHash);
            }

            if ((this.duplicates && deletedOrdinal) || (!this.duplicates && wasBefore && wasDeleted)) {
                this._mutationEventSource?.emit({emitter: this, action: 'delete', data: elementHash});
            }

            this._needToRebuild = true;

        } else {
            throw new Error('Invalid op type for MutableArray:' + op?.getClassName());
        }

        return true;

    }

    private rebuild() {

        if (this._needToRebuild) {
            this._contents = [];
            this._hashes   = [];
            this._ordinals = [];

            const ordinals = Array.from(this._elementsPerOrdinal.keys());
            ordinals.sort();
    
            const seen = new Set<Hash>();
    
            for (const ordinal of ordinals) {
                const elementHashes = this._elementsPerOrdinal.get(ordinal);
    
                for (const elementHash of elementHashes) {
    
                    if (this.duplicates || !seen.has(elementHash)) {
                        this._contents.push(this._elements.get(elementHash) as T);
                        this._hashes.push(elementHash);
                        this._ordinals.push(ordinal);
                        if (!this.duplicates) {
                            seen.add(elementHash);
                        }
                    }
                }
            }

            this._needToRebuild = false;
        }
    }

    getClassName(): string {
        return MutableArray.className;
    }

    init(): void {
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        references;
        return (typeof this.duplicates) === 'boolean' && Types.isTypeConstraint(this.typeConstraints); 
    }
}

type InsertEvent<T> = {emitter: MutableArray<T>, action: 'insert', data: T};
type MoveEvent<T> = {emitter: MutableArray<T>, action: 'insert', data: T};
type DeleteEvent<T> = {emitter: MutableArray<T>, action: 'delete', data: Hash};

type MutationEvent<T> = InsertEvent<T> | MoveEvent<T> | DeleteEvent<T>;

export { MutableArray, InsertOp as MutableArrayInsertOp, DeleteOp as MutableArrayDeleteOp };
export { InsertEvent as ArrayInsertEvent, MoveEvent as ArrayMoveEvent, DeleteEvent as ArrayDeleteEvent,
         MutationEvent as ArrayMutationEvent };