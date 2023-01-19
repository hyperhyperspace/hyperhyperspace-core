import { Hash } from '../../model/hashing';
import { HashedObject, HashedSet, HashReference } from '../../model/immutable';
import { MutationOp } from '../../model/mutable';

import { Ordinal, Ordinals, DenseOrder } from 'util/ordinals';
import { DedupMultiMap } from 'util/dedupmultimap';
import { Logger, LogLevel } from 'util/logging';
import { ArrayMap } from 'util/arraymap';

import { location } from 'util/events';
import { ClassRegistry } from 'data/model/literals';
import { MutableContentEvents } from 'data/model/mutable/MutableObject';
import { MultiMap } from 'util/multimap';
import { BaseCollection, Collection, CollectionConfig, CollectionOp } from './Collection';
import { Identity } from 'data/identity';

// a simple mutable list with a single writer

// can work with or without duplicates (in the latter case, inserting an element already in the set has no effect)

class InsertOp<T> extends CollectionOp<T> {

    static className = 'hhs/v0/MutableArray/InsertOp';

    element?: T;
    ordinal?: Ordinal;

    constructor(target?: MutableArray<T>, element?: T, ordinal?: Ordinal, author?: Identity) {
        super(target);

        this.element = element;
        this.ordinal = ordinal;
        if (author !== undefined) {
            this.setAuthor(author);
        }
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

        const targetObject = this.getTargetObject();

        if (! (targetObject instanceof MutableArray)) {
            return false;
        }

        if (this.element === undefined || !((this.element instanceof HashedObject) || HashedObject.isLiteral(this.element))) {
            return false;
        }

        if (this.ordinal === undefined || !Ordinals.isOrdinal(this.ordinal)) {
            return false;
        }

        return true;
    }
}

class DeleteOp<T> extends CollectionOp<T> {

    static className = 'hhs/v0/MutableArray/DeleteOp';

    elementHash?: Hash;
    deletedOps?: HashedSet<HashReference<InsertOp<T>>>;

    constructor(target?: MutableArray<T>, elementHash?: Hash, insertOps?: IterableIterator<HashReference<InsertOp<T>>>, author?: Identity) {
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

        if (! (targetObject instanceof MutableArray)) {
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

type MutableArrayConfig = { duplicates: boolean }

class MutableArray<T> extends BaseCollection<T> implements Collection<T> {

    static className = 'hhs/v0/MutableArray';
    static opClasses = [InsertOp.className, DeleteOp.className];
    static logger    = new Logger(MutableArray.className, LogLevel.INFO);
    
    duplicates: boolean;

    _elementsPerOrdinal: ArrayMap<Ordinal, Hash>;
    _ordinalsPerElement: ArrayMap<Hash, Ordinal>;
    _elements: Map<Hash, T>;

    _currentInsertOpRefs : DedupMultiMap<Hash, HashReference<InsertOp<T>>>;
    _currentInsertOpOrds : Map<Hash, Ordinal>;

    _needToRebuild: boolean;

    _contents : Array<T>;
    _hashes   : Array<Hash>;
    _ordinals : Array<Ordinal>;

    constructor(config: MutableArrayConfig & CollectionConfig = {duplicates: true}) {
        super(MutableArray.opClasses, config);

        this.setRandomId();

        this.duplicates = config.duplicates;

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
    
    exportMutableState() {
        return {
            _elementsPerOrdinal: this._elementsPerOrdinal.toLiteral(),
            _ordinalsPerElement: this._ordinalsPerElement.toLiteral(),
            _elements: Object.fromEntries(this._elements.entries()),
            _currentInsertOpRefs: this._currentInsertOpRefs.toLiteral(),
            _currentInsertOpOrds: Object.fromEntries(this._currentInsertOpOrds),
        }
    }
    
    importMutableState(state: any) {
        this._elementsPerOrdinal = ArrayMap.fromLiteral<Ordinal, Hash>(state._elementsPerOrdinal);
        this._ordinalsPerElement = ArrayMap.fromLiteral<Hash, Ordinal>(state._ordinalsPerElement);
        this._elements = new Map(Object.entries(state._elements));
        this._currentInsertOpRefs = DedupMultiMap.fromLiteral<Hash, HashReference<InsertOp<T>>>(state._currentInsertOpRefs);
        this._currentInsertOpOrds = new Map(Object.entries(state._currentInsertOpOrds));
        
        this._needToRebuild = true;
        this.rebuild();
    }

    async insertAt(element: T, idx: number, author?: Identity) {
        await this.insertManyAt([element], idx, author);
    }

    async insertManyAt(elements: T[], idx: number, author?: Identity) {
        this.rebuild();

        // In the "no duplicates" case, any items we insert will disappear from their old positions. So
        // we need to count how many are before position idx, and add that to idx to correct.

        if (!this.duplicates) {

            let delta=0;

            for (const element of elements) {
                const elementHash = HashedObject.hashElement(element);

                const elmtIdx = this._hashes.indexOf(elementHash);

                if (0 <= elmtIdx && elmtIdx <= idx) {
                    delta = delta + 1;
                }
            }

            idx = idx + delta;
        }

        let after  : Ordinal|undefined = undefined;
        let before : Ordinal|undefined = undefined;

        if (0 < idx && idx <= this._hashes.length) {
            after = this._ordinals[idx-1];
        }

        if (idx < this._hashes.length) {
            before = this._ordinals[idx];
        }

        for (const element of elements) {

            const elementHash = HashedObject.hashElement(element);

            // MEGA FIXME: This is broken. It may be the case that after === before if there are several items
            //             with the same ordinal in the array. In that case, the items with ordinal before need
            //             to be re-inserted using a higer ordinal to make the insertion possible (only those that
            //             come at and after idx, that is).
            const ordinal = DenseOrder.between(after, before);

            let oldInsertionOps: Set<HashReference<InsertOp<T>>>|undefined = undefined;

            if (!this.duplicates) {
                oldInsertionOps = this._currentInsertOpRefs.get(elementHash);
            }

            const insertOp = new InsertOp(this, element, ordinal, author);
            await this.applyNewOp(insertOp);

            // Note: in the "no duplicates" case, the delete -if necessary- has to come after the 
            // insert (taking care to exclude the newly inserted element). Then, if the new position
            // comes after the old one, the insert will initially have no effect, and the element 
            // will "move" over there after the delete. Hence the size of the list will never decrease,
            // and from the outside it will look like the element was just repositioned.

            if (oldInsertionOps !== undefined && oldInsertionOps.size > 0) {
                const deleteOp = new DeleteOp(this, elementHash, oldInsertionOps.values());
                await this.applyNewOp(deleteOp);
            }

            after = ordinal;
        }
    }

    async deleteAt(idx: number, author?: Identity) {
        await this.deleteManyAt(idx, 1, author);
    }

    async deleteManyAt(idx: number, count: number, author?: Identity) {
        this.rebuild();

        while (idx < this._contents.length && count > 0) {
            let hash = this._hashes[idx];

            if (this.duplicates) {
                await this.delete(hash, this._ordinals[idx], author);
            } else {
                await this.delete(hash, undefined, author);
            }

            idx = idx + 1;
            count = count - 1;
        }
    }

    async deleteElement(element: T, author?: Identity) {
        this.deleteElementByHash(HashedObject.hashElement(element), author);
    }

    async deleteElementByHash(hash: Hash, author?: Identity) {
        this.rebuild();
        this.delete(hash, undefined, author);
    }

    async push(element: T, author?: Identity) {
        await this.insertAt(element, this._contents.length, author);
    }

    async pop(author?: Identity): Promise<T> {
        this.rebuild();
        const lastIdx = this._contents.length - 1;
        const last = this._contents[lastIdx];
        await this.deleteAt(lastIdx, author);

        return last;
    }

    async concat(elements: T[], author?: Identity) {
        this.rebuild();
        await this.insertManyAt(elements, this._contents.length, author);
    }

    contents() {
        this.rebuild();
        return Array.from(this._contents);
    }

    contentHashes() {
        this.rebuild();
        return Array.from(this._hashes);
    }

    values(): IterableIterator<T> {
        return this.contents().values();
    }

    lookup(idx: number): T {
        this.rebuild();
        return this._contents[idx];
    }

    lookupHash(idx: number): Hash {
        this.rebuild();
        return this._hashes[idx];
    }

    indexOf(element?: T) {
        return this.indexOfByHash(HashedObject.hashElement(element));
    }

    indexOfByHash(hash?: Hash) {
        if (hash === undefined) {
            return -1;
        }
        this.rebuild();
        return this._hashes.indexOf(hash);
    }
    
    valueAt(idx: number) {
        this.rebuild();
        return this._contents[idx];
    }

    private async delete(hash: Hash, ordinal?: Ordinal, author?: Identity) {

        let deleteOp: DeleteOp<T>|undefined = undefined;
        const insertOpRefs = this._currentInsertOpRefs.get(hash);

        if (ordinal !== undefined) {
            for (const insertOpRef of insertOpRefs.values()) {
                if (this._currentInsertOpOrds.get(insertOpRef.hash) === ordinal) {
                    deleteOp = new DeleteOp(this, hash, [insertOpRef].values(), author);
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

    has(element: T): boolean {
        return this.indexOf(element) >= 0;
    }

    hasByHash(hash: Hash): boolean {
        return this.indexOfByHash(hash) >= 0;
    }

    async mutate(op: MutationOp): Promise<boolean> {

        const opHash = op.getLastHash();

        if (op instanceof InsertOp) {

            const element = op.element as T;
            const ordinal = op.ordinal as Ordinal;

            const elementHash = HashedObject.hashElement(element);

            this._elementsPerOrdinal.add(ordinal, elementHash);
            this._ordinalsPerElement.add(elementHash, ordinal);

            let wasNotBefore = false;

            if (this._currentInsertOpRefs.get(elementHash).size === 0) {
                wasNotBefore = true;
                this._elements.set(elementHash, element);
            }

            this._currentInsertOpRefs.add(elementHash, new HashReference(op.getLastHash(), op.getClassName()));
            this._currentInsertOpOrds.set(opHash, ordinal);

            this._needToRebuild = true;

            if (wasNotBefore && element instanceof HashedObject) {
                this._mutationEventSource?.emit({emitter: this, action: MutableContentEvents.AddObject, data: element});
            }

            if (this.duplicates || wasNotBefore) {
                this._mutationEventSource?.emit({emitter: this, action: 'insert', data: element} as InsertEvent<T>);
            } else {
                this._mutationEventSource?.emit({emitter: this, action: 'move', data: element} as MoveEvent<T>);
            }

        } else if (op instanceof DeleteOp) {

            const elementHash = op.elementHash as Hash;
            const deletedOps = op.deletedOps as HashedSet<HashReference<DeleteOp<T>>>;
            
            let wasBefore = false;
            let element: T|undefined;

            if (this._currentInsertOpRefs.get(elementHash).size > 0) {
                wasBefore = true;
                element = this._elements.get(elementHash);
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

            this._needToRebuild = true;

            if (wasDeleted) {
                if (wasBefore) {
                    const element = this._elements.get(elementHash);
                    this._elements.delete(elementHash);
                    if (element instanceof HashedObject) {
                        this._mutationEventSource?.emit({emitter: this, action: MutableContentEvents.RemoveObject, data: element});
                    }
                }
            }

            if ((this.duplicates && deletedOrdinal) || (!this.duplicates && wasBefore && wasDeleted)) {
                this._mutationEventSource?.emit({emitter: this, action: 'delete', data: elementHash} as DeleteEvent<T>);
            } else if (!this.duplicates && wasBefore) {
                this._mutationEventSource?.emit({emitter: this, action: 'move', data: element} as MoveEvent<T>);
            }

            

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

    getMutableContents(): MultiMap<Hash, HashedObject> {

        const contents = new MultiMap<Hash, HashedObject>();

        for (const [hash, elmt] of this._elements.entries()) {
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


    getClassName(): string {
        return MutableArray.className;
    }

    init(): void {
        
    }

    shouldAcceptMutationOp(op: MutationOp, opReferences: Map<Hash, HashedObject>): boolean {

        if (!super.shouldAcceptMutationOp(op, opReferences)) {
            return false;
        }

        if (op instanceof InsertOp && !this.shouldAcceptElement(op.element as T)) {
            return false;
        }

        return true;
    }
}

ClassRegistry.register(InsertOp.className, InsertOp);
ClassRegistry.register(DeleteOp.className, DeleteOp);
ClassRegistry.register(MutableArray.className, MutableArray);


type InsertEvent<T> = {emitter: MutableArray<T>, action: 'insert', path?: location<HashedObject>[], data: T};
type MoveEvent<T>   = {emitter: MutableArray<T>, action: 'move', path?: location<HashedObject>[], data: T};
type DeleteEvent<T> = {emitter: MutableArray<T>, action: 'delete', path?: location<HashedObject>[], data: Hash};

type MutationEvent<T> = InsertEvent<T> | MoveEvent<T> | DeleteEvent<T>;

export { MutableArray, InsertOp as MutableArrayInsertOp, DeleteOp as MutableArrayDeleteOp };
export { InsertEvent as ArrayInsertEvent, MoveEvent as ArrayMoveEvent, DeleteEvent as ArrayDeleteEvent,
         MutationEvent as ArrayMutationEvent };