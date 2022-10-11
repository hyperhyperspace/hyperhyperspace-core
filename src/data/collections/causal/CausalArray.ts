import { Hash } from '../../model/hashing';
import { HashedObject } from '../../model/immutable';
import { MutationOp } from '../../model/mutable';

import { Ordinal, Ordinals, DenseOrder } from 'util/ordinals';
import { DedupMultiMap } from 'util/dedupmultimap';
import { Logger, LogLevel } from 'util/logging';
import { ArrayMap } from 'util/arraymap';

import { Authorizer } from '../../model/causal/Authorization'
import { Authorization, Verification } from '../../model/causal/Authorization';

import { location } from 'util/events';
import { ClassRegistry } from 'data/model/literals';
import { MutableContentEvents } from 'data/model/mutable/MutableObject';
import { MultiMap } from 'util/multimap';
import { InvalidateAfterOp } from 'data/model/causal';
import { BaseCausalCollection, CausalCollection, CausalCollectionConfig, CausalCollectionOp } from './CausalCollection';
import { Identity } from 'data/identity';

// A mutable list with a 

// can work with or without duplicates (in the latter case, inserting an element already in the set has no effect)

class InsertOp<T> extends MutationOp {

    static className = 'hhs/v0/CausalArray/InsertOp';

    element?: T;
    ordinal?: Ordinal;

    constructor(target?: CausalArray<T>, element?: T, ordinal?: Ordinal) {
        super(target);

        this.element = element;
        this.ordinal = ordinal;
    }

    getClassName(): string {
        return InsertOp.className;
    }

    init(): void {
        
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

        return true;
    }
}

class DeleteOp<T> extends InvalidateAfterOp {

    static className = 'hhs/v0/CausalArray/DeleteOp';

    constructor(insertOp?: InsertOp<T>) {
        super(insertOp);
    }

    init() {
        super.init();
    }

    async validate(references: Map<Hash, HashedObject>) {
        return await super.validate(references) && this.targetOp !== undefined && this.targetOp instanceof InsertOp;
    }

    getClassName(): string {
        return DeleteOp.className;
    }

    getInsertOp() {
        return this.getTargetOp() as InsertOp<T>;
    }
    
}

class MembershipAttestationOp<T> extends MutationOp {
    static className = 'hhs/v0/CausalArray/MembershipAttestationOp';

    targetOpNonCausalHash?: Hash;

    constructor(insertOp?: InsertOp<T>, targetOp?: MutationOp) {
        super(insertOp?.getTargetObject());

        if (insertOp !== undefined) {
            if (targetOp === undefined) {
                throw new Error('Attempted to construct a CausalArray MembershipOp, but no targetOp was provided.');
            }

            this.addCausalOp('insert-op', insertOp);

            this.targetOpNonCausalHash = targetOp.nonCausalHash();
        }
    }

    getClassName(): string {
        return MembershipAttestationOp.className;
    }

    init(): void {
        
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        if (!await super.validate(references)) {
            return false;
        }

        if (this.causalOps === undefined) {
            CausalArray.validationLog.debug('MembershipAttestationOps should have exactly one causalOp, and causalOps is undefined');
        }

        if (this.getCausalOps().size() !== 1) {
            CausalArray.validationLog.debug('MembershipAttestationOps should have exactly one causalOp');
            return false;
        }

        const insertOp = this.getInsertOp();

        if (insertOp === undefined || !(insertOp instanceof InsertOp)) {
            CausalArray.validationLog.debug('insertOp is missing from MembershipAttestationOp ' + this.hash())
            return false;
        }

        if (!insertOp.getTargetObject().equals(this.getTargetObject())) {
            CausalArray.validationLog.debug('insertOp for MembershipAttestationOp ' + this.hash() + ' has a different target')
            return false;
        }

        if (this.targetOpNonCausalHash === undefined) {
            CausalArray.validationLog.debug('insertOpNonCausalHash is missing for MembershipAttestationOp ' + this.hash());
            return false;
        }

        return true;
    }
    
    getInsertOp() {
        return this.getCausalOps().get('insert-op') as InsertOp<T>;
    }
}

type MutableArrayConfig = { duplicates: boolean }

class CausalArray<T> extends BaseCausalCollection<T> implements CausalCollection<T> {

    static className = 'hhs/v0/CausalArray';
    static opClasses = [InsertOp.className, DeleteOp.className];
    static logger    = new Logger(CausalArray.className, LogLevel.INFO);
    
    duplicates: boolean;

    _elementsPerOrdinal: ArrayMap<Ordinal, Hash>;
    _ordinalsPerElement: ArrayMap<Hash, Ordinal>;
    _elements: Map<Hash, T>;

    _currentInsertOps    : DedupMultiMap<Hash, InsertOp<T>>;
    _currentInsertOpOrds : Map<Hash, Ordinal>;

    _needToRebuild: boolean;

    _contents : Array<T>;
    _hashes   : Array<Hash>;
    _ordinals : Array<Ordinal>;

    constructor(config?: MutableArrayConfig & CausalCollectionConfig) {
        super(CausalArray.opClasses, config);

        this.setRandomId();

        this.duplicates = config?.duplicates === undefined? true: config?.duplicates;

        this._elementsPerOrdinal = new ArrayMap();
        this._ordinalsPerElement = new ArrayMap();
        this._elements = new Map();

        this._currentInsertOps    = new DedupMultiMap();
        this._currentInsertOpOrds = new Map();

        this._needToRebuild = false;
        this._contents = [];
        this._hashes   = [];
        this._ordinals = [];
    }

    async insertAt(element: T, idx: number, author?: Identity, extraAuth?: Authorizer): Promise<boolean> {
        return this.insertManyAt([element], idx, author, extraAuth);
    }

    async insertManyAt(elements: T[], idx: number, author?: Identity, extraAuth?: Authorizer): Promise<boolean> {
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
            //             to be re-inserted using a higher ordinal to make the insertion possible (only those that
            //             come at and after idx, that is).
            const ordinal = DenseOrder.between(after, before);

            let oldInsertionOps: Set<InsertOp<T>>|undefined = undefined;

            if (!this.duplicates) {
                oldInsertionOps = this._currentInsertOps.get(elementHash);
            }

            const insertOp = new InsertOp(this, element, ordinal);

            if (author !== undefined) {
                insertOp.setAuthor(author);
            } else {
                CausalCollectionOp.setSingleAuthorIfNecessary(insertOp);
            }

            const auth = Authorization.chain(this.createInsertAuthorizer(element, insertOp.getAuthor()), extraAuth);

            this.setCurrentPrevOpsTo(insertOp);

            if (!(await auth.attempt(insertOp))) {
                return false;
            }

            await this.applyNewOp(insertOp);

            // Note: in the "no duplicates" case, the delete -if necessary- has to come after the 
            // insert (taking care to exclude the newly inserted element). Then, if the new position
            // comes after the old one, the insert will initially have no effect, and the element 
            // will "move" over there after the delete. Hence the size of the list will never decrease,
            // and from the outside it will look like the element was just repositioned.

            if (oldInsertionOps !== undefined) {

                for (const oldInsertionOp of oldInsertionOps) {
                    const deleteOp = new DeleteOp(oldInsertionOp);
                    await this.applyNewOp(deleteOp);
                }

                
            }

            after = ordinal;
        }

        return true;
    }

    async deleteAt(idx: number, author?: Identity, extraAuth?: Authorizer) {
        await this.deleteManyAt(idx, 1, author, extraAuth);
    }

    async deleteManyAt(idx: number, count: number, author?: Identity, extraAuth?: Authorizer) {
        this.rebuild();

        while (idx < this._contents.length && count > 0) {
            let hash = this._hashes[idx];

            if (this.duplicates) {
                await this.delete(hash, this._ordinals[idx], author, extraAuth);
            } else {
                await this.delete(hash, undefined, author, extraAuth);
            }

            idx = idx + 1;
            count = count - 1;
        }
    }

    async deleteElement(element: T, author?: Identity, extraAuth?: Authorizer) {
        this.deleteElementByHash(HashedObject.hashElement(element), author, extraAuth);
    }

    async deleteElementByHash(hash: Hash, author?: Identity, extraAuth?: Authorizer) {
        this.rebuild();
        this.delete(hash, undefined, author, extraAuth);
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

    contentHashes() {
        this.rebuild();
        return Array.from(this._hashes);
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

    private async delete(hash: Hash, ordinal?: Ordinal, author?: Identity, extraAuth?: Authorizer) {

        let deleteOp: DeleteOp<T>|undefined = undefined;
        const insertOps = this._currentInsertOps.get(hash);

        for (const insertOp of insertOps.values()) {
            if (this._currentInsertOpOrds.get(insertOp.getLastHash()) === ordinal) {
                deleteOp = new DeleteOp(insertOp);

                if (author !== undefined) {
                    deleteOp.setAuthor(author);
                } else {
                    CausalCollectionOp.setSingleAuthorIfNecessary(deleteOp);
                }
    
                const auth = Authorization.chain(this.createDeleteAuthorizer(insertOp.element as T, deleteOp.getAuthor()), extraAuth);
    
                this.setCurrentPrevOpsTo(deleteOp);
    
                if (!(await auth.attempt(deleteOp))) {
                    return false;
                }

                await this.applyNewOp(deleteOp);
                if (ordinal !== undefined) {
                    break;
                }
            }
        }

        return true;
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

            if (this._currentInsertOps.get(elementHash).size === 0) {
                wasNotBefore = true;
                this._elements.set(elementHash, element);
            }

            this._currentInsertOps.add(elementHash, op);
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

            const deletedOp     = op.getTargetOp() as InsertOp<T>;
            const deletedOpHash = deletedOp.getLastHash();
            const elementHash   = HashedObject.hashElement(deletedOp.element);
            

            let wasBefore = false;
            let element: T|undefined;

            if (this._currentInsertOps.get(elementHash).size > 0) {
                wasBefore = true;
                element = this._elements.get(elementHash);
            }

            let deletedOrdinal = false;


            if (this._currentInsertOps.delete(elementHash, deletedOp)) {
                const ordinal = this._currentInsertOpOrds.get(deletedOpHash) as Ordinal;
                this._currentInsertOpOrds.delete(deletedOpHash);

                this._elementsPerOrdinal.delete(ordinal, elementHash);
                this._ordinalsPerElement.delete(elementHash, ordinal);

                deletedOrdinal = true;
            }

            let current = this._currentInsertOps.get(elementHash);

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
        return CausalArray.className;
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

        if (op instanceof InsertOp || op instanceof DeleteOp) {
            const author = op.getAuthor();

            const auth = (op instanceof InsertOp) ?
                                            this.createInsertAuthorizer(op.element, author)
                                                        :
                                            this.createDeleteAuthorizerByHash(
                                                    HashedObject.hashElement(op.getInsertOp().element), author);

            const usedKeys     = new Set<string>();

            if (!auth.verify(op, usedKeys)) {
                return false;
            }

            if (!Verification.checkKeys(usedKeys, op)) {
                return false;
            }

        }

        return true;
    }


    attestationKey(elmt: T) {
        return this.attestationKeyByHash(HashedObject.hashElement(elmt));
    }

    attestationKeyByHash(hash: Hash) {
        return 'CausalArray/attest-member:' + hash + '-belongs-to-' + this.hash();
    }

    async attestMembershipForOp(elmt: T, op: MutationOp): Promise<boolean> {

        const hash = HashedObject.hashElement(elmt);

        return this.attestMembershipForOpByHash(hash, op);
    }

    async attestMembershipForOpByHash(hash: Hash, op: MutationOp): Promise<boolean> {

        const insertOps = this._currentInsertOps.get(hash);

        if (insertOps.size > 0) {
            const insertOp = insertOps.values().next().value as InsertOp<T>;

            const attestOp = new MembershipAttestationOp(insertOp, op);

            await this.applyNewOp(attestOp);
            const key = this.attestationKeyByHash(hash);
            op.addCausalOp(key, attestOp);

            return true;
        } else {
            return false;
        }

    }

    verifyMembershipAttestationForOp(elmt: T, op: MutationOp, usedKeys: Set<string>): boolean {

        return this.checkMembershipAttestationByHashForOp(HashedObject.hashElement(elmt), op, usedKeys);
    }

    protected checkMembershipAttestationByHashForOp(elmtHash: Hash, op: MutationOp, usedKeys: Set<string>): boolean {

        const key = this.attestationKeyByHash(elmtHash);

        const attestOp = op.getCausalOps().get(key);

        if (attestOp === undefined) {
            return false;
        }

        if (!(attestOp instanceof MembershipAttestationOp)) {
            return false;
        }

        if (!attestOp.getTargetObject().equals(this)) {
            return false;
        }

        if (attestOp.targetOpNonCausalHash !== op.nonCausalHash()) {
            return false;
        }

        const insertOp = attestOp.getInsertOp();

        if (HashedObject.hashElement(insertOp.element) !== elmtHash) {
            return false;
        }

        usedKeys.add(key);

        return true;
    }

    createMembershipAuthorizer(elmt: T): Authorizer {

        return {
            attempt : (op:  MutationOp) => this.attestMembershipForOp(elmt, op),
            verify  : (op: MutationOp, usedKeys: Set<string>) => this.verifyMembershipAttestationForOp(elmt, op, usedKeys)
        };

    }

    protected createInsertAuthorizer(elmt: T, author?: Identity): Authorizer {

        if (!this.shouldAcceptElement(elmt)) {
            return Authorization.never;
        } else {
            return this.createWriteAuthorizer(author);
        }
    }

    protected createDeleteAuthorizer(elmt: T, author?: Identity): Authorizer {
        return this.createDeleteAuthorizerByHash(HashedObject.hashElement(elmt), author);
    }

    protected createDeleteAuthorizerByHash(_elmtHash: Hash, author?: Identity): Authorizer {
        return this.createWriteAuthorizer(author);
    }

    values() {
        this.rebuild();
        return this._contents.values();
    }
    
    size() {
        this.rebuild()
        return this._contents.length;
    }
}

ClassRegistry.register(InsertOp.className, InsertOp);
ClassRegistry.register(DeleteOp.className, DeleteOp);
ClassRegistry.register(CausalArray.className, CausalArray);


type InsertEvent<T> = {emitter: CausalArray<T>, action: 'insert', path?: location<HashedObject>[], data: T};
type MoveEvent<T>   = {emitter: CausalArray<T>, action: 'move', path?: location<HashedObject>[], data: T};
type DeleteEvent<T> = {emitter: CausalArray<T>, action: 'delete', path?: location<HashedObject>[], data: Hash};

type MutationEvent<T> = InsertEvent<T> | MoveEvent<T> | DeleteEvent<T>;

export { CausalArray, InsertOp as CausalArrayInsertOp, DeleteOp as CausalArrayDeleteOp };
export { InsertEvent as CausalArrayInsertEvent, MoveEvent as CausalArrayMoveEvent, DeleteEvent as CausalArrayDeleteEvent,
         MutationEvent as CausalArrayMutationEvent };