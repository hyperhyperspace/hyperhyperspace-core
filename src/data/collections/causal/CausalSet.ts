import { Identity } from '../../identity';
import { Hash, HashedObject } from '../../model';
import { MutationOp, InvalidateAfterOp } from '../../model';
import { Authorizer } from '../../model/causal/Authorization'

import { MultiMap } from 'util/multimap';
import { Authorization, Verification } from '../../model/causal/Authorization';
import { HashedSet } from '../../model/immutable/HashedSet';
import { MutableSetEvents } from '../../collections/mutable/MutableSet';
import { MutableContentEvents } from '../../model/mutable/MutableObject';
import { AuthError, BaseCausalCollection, CausalCollection, CausalCollectionConfig } from './CausalCollection';
import { ClassRegistry } from 'data/model/literals';

/*
 * CausalSet: A set with an explicit membership attestation op that can be used by other objects
 *            as a causal dependency to prove that when something happened, this set contained
 *            a given element. When an element is deleted, an 'InvalidateAfterOp' is
 *            generated, causing any membership attestation ops that were generated concurrently 
 *            to be undone automatically, as well as any ops that have them as causal dependencies,
 *            by the cascading undo/redo mechanism.
 */

class AddOp<T> extends MutationOp {
    static className = 'hss/v0/CausalSet/AddOp';

    element?: T;

    constructor(targetObject?: CausalSet<T>, element?: T, author?: Identity) {
        super(targetObject);

        this.element = element;
        if (author !== undefined) {
            this.setAuthor(author);
        }
    }

    getClassName(): string {
        return AddOp.className;
    }

    init(): void {
        
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        if (!(await super.validate(references))) {
            return false;
        }

        const mut = this.getTargetObject();

        if (this.element === undefined) {
            return false;
        }

        if (!(mut instanceof CausalSet)) {
            return false;
        }

        if (mut.acceptedElementHashes !== undefined && !mut.acceptedElementHashes.has(HashedObject.hashElement(this.element))) {
            return false;
        }

        if (mut.acceptedTypes !== undefined && 
              !(
                (this.element instanceof HashedObject && mut.acceptedTypes.has(this.element.getClassName())) 
                        ||
                (!(this.element instanceof HashedObject) && mut.acceptedTypes.has(typeof(this.element)))
               )
                
        ) {

            return false;

        }
    
        return true;
    }

    getElement() {
        return this.element as T;
    }
    
}

class DeleteOp<T> extends InvalidateAfterOp {
    static className = 'hss/v0/CausalSet/DeleteOp';

    constructor(targetOp?: AddOp<T>, author?: Identity) {
        super(targetOp);

        if (author !== undefined) {
            this.setAuthor(author);
        }
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {
        return await super.validate(references) && this.targetOp !== undefined && this.targetOp instanceof AddOp;
    }

    getClassName(): string {
        return DeleteOp.className;
    }

    getAddOp(): AddOp<T> {
        return this.getTargetOp() as AddOp<T>;
    }
    
}

class MembershipAttestationOp<T> extends MutationOp {
    static className = 'hhs/v0/CausalSet/MembershipAttestationOp';

    targetOpNonCausalHash?: Hash;

    constructor(addOp?: AddOp<T>, targetOp?: MutationOp) {
        super(addOp?.getTargetObject());

        if (addOp !== undefined) {
            if (targetOp === undefined) {
                throw new Error('Attempted to construct a CausalSet MembershipOp, but no targetOp was provided.');
            }

            this.addCausalOp('add-op', addOp);

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
            CausalSet.validationLog.debug('MembershipAttestationOps should have exactly one causalOp, and causalOps is undefined');
        }

        if (this.getCausalOps().size() !== 1) {
            CausalSet.validationLog.debug('MembershipAttestationOps should have exactly one causalOp');
            return false;
        }

        const addOp = this.getAddOp();

        if (addOp === undefined || !(addOp instanceof AddOp)) {
            CausalSet.validationLog.debug('addOp is missing from MembershipAttestationOp ' + this.hash())
            return false;
        }

        if (!addOp.getTargetObject().equals(this.getTargetObject())) {
            CausalSet.validationLog.debug('addOp for MembershipAttestationOp ' + this.hash() + ' has a different target')
            return false;
        }

        if (this.targetOpNonCausalHash === undefined) {
            CausalSet.validationLog.debug('targetOpNonCausalHash is missing for MembershipAttestationOp ' + this.hash());
            return false;
        }

        return true;
    }
    
    getAddOp() {
        return this.getCausalOps().get('add-op') as AddOp<T>;
    }
}

class CausalSet<T> extends BaseCausalCollection<T> implements CausalCollection<T> {

    static className = 'hhs/v0/CausalSet';
    static opClasses = [AddOp.className, DeleteOp.className, MembershipAttestationOp.className];

    acceptedTypes?: HashedSet<string>;
    acceptedElementHashes?: HashedSet<Hash>;

    // valid: all additions and deletions that have NOT been invalidated.
    _validAddOpsPerElmt     : MultiMap<Hash, Hash>;
    _validDeleteOpsPerAddOp : MultiMap<Hash, Hash>;


    // current: all valid additions that have no valid deletions (i.e. the actual set members!)
    _currentAddOps        : Map<Hash, AddOp<T>>;
    _currentAddOpsPerElmt : MultiMap<Hash, Hash>;

    // the actual elements (incl. the delted ones! deletions may be undone)
    _allElements: Map<Hash, T>;


    constructor(config: CausalCollectionConfig = {}) {
        super(CausalSet.opClasses, {...config, supportsUndo: true});

        this.setRandomId();
        
        this._allElements = new Map();

        // valid: all additions and deletions that have NOT been invalidated.
        this._validAddOpsPerElmt     = new MultiMap();
        this._validDeleteOpsPerAddOp = new MultiMap();

        this._currentAddOps        = new Map();
        this._currentAddOpsPerElmt = new MultiMap();

        
    }

    getClassName() {
        return CausalSet.className;
    }

    canAdd(author?: Identity, extraAuth?: Authorizer): Promise<boolean> {
        return Authorization.chain(this.createAddAuthorizer(author), extraAuth).attempt();
    }

    canDelete(author?: Identity, extraAuth?: Authorizer): Promise<boolean> {
        return Authorization.chain(this.createDeleteAuthorizer(author), extraAuth).attempt();
    }


    async add(elmt: T, author?: Identity, extraAuth?: Authorizer): Promise<boolean> {

        if (!(elmt instanceof HashedObject) && !HashedObject.isLiteral(elmt)) {
            throw new Error('CausalSets can contain either a class deriving from HashedObject or a pure literal (a constant, without any HashedObjects within).');
        }

        if (!this.shouldAcceptElement(elmt)) {
            throw new Error('CausalSet has type/element contraints that reject the element that is being added:' + elmt)
        }
        
        const addOp = new AddOp(this, elmt, author);

        const auth = Authorization.chain(this.createAddAuthorizer(addOp.getAuthor()), extraAuth);

        this.setCurrentPrevOpsTo(addOp);

        if (!(await auth.attempt(addOp))) {
            throw new AuthError('Cannot authorize addition operation on CausalSet ' + this.hash() + ', author is: ' + author?.hash());;
        }
        
        return this.applyNewOp(addOp).then(() => true);

    }

    async delete(elmt: T, author?: Identity, extraAuth?: Authorizer): Promise<boolean> {

        const hash = HashedObject.hashElement(elmt);
        
        return this.deleteByHash(hash, author, extraAuth);
    }

    async deleteByHash(hash: Hash, author?: Identity, extraAuth?: Authorizer): Promise<boolean> {

        const deleteOps: Array<DeleteOp<T>> = [];
        
        for (const addOpHash of this._currentAddOpsPerElmt.get(hash)) {
            const addOp = this._currentAddOps.get(addOpHash) as AddOp<T>;
            const deleteOp = new DeleteOp(addOp, author);

            const auth = Authorization.chain(this.createDeleteAuthorizer(deleteOp.getAuthor()), extraAuth);

            this.setCurrentPrevOpsTo(deleteOp);

            if (!(await auth.attempt(deleteOp))) {
                throw new AuthError('Cannot authorize delete operation on CausalSet ' + this.hash() + ', author is: ' + author?.hash());
            }
            
            deleteOps.push(deleteOp);
        }

        const deletions: Array<Promise<void>> = [];

        for (const deleteOp of deleteOps) {
            deletions.push(this.applyNewOp(deleteOp));
        }

        await Promise.all(deletions);

        return deleteOps.length > 0;
    }

    has(elmt: T): boolean {
        return this.hasByHash(HashedObject.hashElement(elmt));
    }

    hasByHash(hash: Hash): boolean {
        return this._currentAddOpsPerElmt.get(hash).size > 0;
    }

    get(hash: Hash): T|undefined {
        if (this.hasByHash(hash)) {
            return this._allElements.get(hash);
        } else {
            return undefined;
        }
    }

    attestationKey(elmt: T) {
        return this.attestationKeyByHash(HashedObject.hashElement(elmt));
    }

    attestationKeyByHash(hash: Hash) {
        return 'CausalSet/attest:' + hash + '-belongs-to-' + this.hash();
    }

    async attestMembershipForOp(elmt: T, op?: MutationOp): Promise<boolean> {

        const hash = HashedObject.hashElement(elmt);

        return this.attestMembershipForOpByHash(hash, op);
    }

    async attestMembershipForOpByHash(hash: Hash, op?: MutationOp): Promise<boolean> {

        const addOpHashes = this._currentAddOpsPerElmt.get(hash);

        if (addOpHashes.size > 0) {

            if (op !== undefined) {
                const addOpHash = addOpHashes.values().next().value as Hash;
                const addOp     = this._currentAddOps.get(addOpHash) as AddOp<T>;

                const attestOp = new MembershipAttestationOp(addOp, op);

                await this.applyNewOp(attestOp);
                const key = this.attestationKeyByHash(hash);
                op.addCausalOp(key, attestOp);
            }
            
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

        const addOp = attestOp.getAddOp();

        if (HashedObject.hashElement(addOp.getElement()) !== elmtHash) {
            return false;
        }

        usedKeys.add(key);

        return true;
    }

    shouldAcceptMutationOp(op: MutationOp, opReferences: Map<Hash, HashedObject>): boolean {

        if (!super.shouldAcceptMutationOp(op, opReferences)) {
            return false;
        }

        if (op instanceof AddOp && !this.shouldAcceptElement(op.element as T)) {
            return false;
        }

        if (op instanceof AddOp || op instanceof DeleteOp) {
            const author = op.getAuthor();

            const auth = (op instanceof AddOp) ?
                                            this.createAddAuthorizer(author)
                                                        :
                                            this.createDeleteAuthorizer(author);;
                                                                                
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

    async mutate(op: MutationOp, valid: boolean, cascade: boolean): Promise<boolean> {

        if (valid && cascade) {
            //console.log('***** REDO REDO REDO REDO REDO *****');
            //console.log(op.getClassName() + ' for ' + op.getTargetObject().hash());

            if (op instanceof AddOp) {
                //console.log('reinstating ' + op.element);
            }
        }

        let mutated = false;

        if (op instanceof AddOp || op instanceof DeleteOp) {

            let addOp     : AddOp<T>|undefined;
            let addOpHash : Hash|undefined;
            let elementHash  : Hash|undefined;

            if (op instanceof AddOp) {

                addOp       = op;
                addOpHash   = addOp.hash();
                elementHash = HashedObject.hashElement(addOp.getElement());

                if (valid) {
                    this._validAddOpsPerElmt.add(elementHash, addOpHash);
                } else {
                    this._validAddOpsPerElmt.delete(elementHash, addOpHash);
                }
                
                if (!cascade) {
                    this._allElements.set(elementHash, addOp.element as T);
                }

            } else if (op instanceof DeleteOp) {

                const deleteOpHash = op.hash();

                addOp       = op.getTargetOp() as AddOp<T>;
                addOpHash   = addOp.hash();
                elementHash = HashedObject.hashElement(addOp.getElement());

                if (valid) {
                    this._validDeleteOpsPerAddOp.add(addOpHash, deleteOpHash);
                } else {
                    this._validDeleteOpsPerAddOp.delete(addOpHash, deleteOpHash); 
                }

            } else {
                throw new Error("This should be impossible")
            }

            const wasInBefore = this._currentAddOpsPerElmt.get(elementHash).size > 0;

            if ( this._validAddOpsPerElmt.has(elementHash, addOpHash) && 
                 this._validDeleteOpsPerAddOp.get(addOpHash).size === 0 ) {
                
                //console.log('ADDED ' + addOp.getElement())
                this._currentAddOps.set(addOpHash, addOp);
                this._currentAddOpsPerElmt.add(elementHash, addOpHash);
            } else {
                //console.log('DELETED ' + addOp.getElement())
                this._currentAddOps.delete(addOpHash);
                this._currentAddOpsPerElmt.delete(elementHash, addOpHash);
            }

            const isInNow = this._currentAddOpsPerElmt.get(elementHash).size > 0;

            mutated = wasInBefore !== isInNow;

            if (mutated) {

                if ((op instanceof AddOp && valid) || (op instanceof DeleteOp && !valid)) {
                    this._mutationEventSource?.emit({emitter: this, action: MutableSetEvents.Add, data: addOp.element});
                    if (addOp.element instanceof HashedObject) {
                        this._mutationEventSource?.emit({emitter: this, action: MutableContentEvents.AddObject, data: addOp.element});
                    }    
                } else if ((op instanceof AddOp && !valid) || (op instanceof DeleteOp && valid)) {
                    this._mutationEventSource?.emit({emitter: this, action: MutableSetEvents.Delete, data: addOp.element});
                    if (addOp.element instanceof HashedObject) {
                        this._mutationEventSource?.emit({emitter: this, action: MutableContentEvents.RemoveObject, data: addOp.element});
                    }
                }
            }

        }

        return mutated;
    }

    init(): void {
        
    }

    getMutableContents(): MultiMap<Hash, HashedObject> {
        const contents = new MultiMap<Hash, HashedObject>();

        for (const hash of this._currentAddOpsPerElmt.keys()) {
            const elmt = this._allElements.get(hash);

            if (elmt instanceof HashedObject) {
                contents.add(hash, elmt);
            }
        }

        return contents;
    }

    getMutableContentByHash(hash: Hash): Set<HashedObject> {

        const found = new Set<HashedObject>();
        
        if (this._validAddOpsPerElmt.hasKey(hash)) {
            const elmt = this._allElements.get(hash);

            if (elmt instanceof HashedObject) {
                found.add(elmt);
            }    
        }

        return found;
    }

    protected createAddAuthorizer(author?: Identity): Authorizer {
        return this.createWriteAuthorizer(author);
    }

    protected createDeleteAuthorizer(author?: Identity): Authorizer {
        return this.createWriteAuthorizer(author);
    }

    createMembershipAuthorizer(elmt: T): Authorizer {

        return {
            attempt : (op?:  MutationOp) => this.attestMembershipForOp(elmt, op),
            verify  : (op: MutationOp, usedKeys: Set<string>) => this.verifyMembershipAttestationForOp(elmt, op, usedKeys)
        };

    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        return super.validate(references);
    }

    checkAcceptedTypes(acceptedTypes: Array<string>): boolean {
        return (this.acceptedTypes !== undefined && this.acceptedTypes.equals(new HashedSet(acceptedTypes.values())));
    }

    checkAcceptedTypesIsMissing(): boolean {
        return this.acceptedTypes === undefined;
    }

    checkAcceptedElements(acceptedElements: Array<any>): boolean {
        const expected = new HashedSet<Hash>();

        acceptedElements.forEach((elmt: any) => expected.add(HashedObject.hashElement(elmt)));

        return (this.acceptedElementHashes !== undefined && this.acceptedElementHashes.equals(expected));
    }

    checkAcceptedElementsIsMissing(): boolean {
        return this.acceptedElementHashes === undefined;
    }

    values() {
        return Array.from(this._currentAddOpsPerElmt.keys()).map((h: Hash) => this._allElements.get(h) as T).values();
    }
    
    size() {
        return Array.from(this._currentAddOpsPerElmt.keys()).map((h: Hash) => this._allElements.get(h) as T).length;
    }
}

ClassRegistry.register(AddOp.className, AddOp);
ClassRegistry.register(DeleteOp.className, DeleteOp);
ClassRegistry.register(MembershipAttestationOp.className, MembershipAttestationOp);
ClassRegistry.register(CausalSet.className, CausalSet);

export { CausalSet, AddOp as CausalSetAddOp, DeleteOp as CausalSetDeleteOp, MembershipAttestationOp as CausalSetMembershipAttestationOp };

