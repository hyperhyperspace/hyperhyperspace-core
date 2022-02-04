import { Identity } from '../identity';
import { Hash, HashedObject } from '../model';
import { MutableObject, MutationOp, InvalidateAfterOp } from '../model';
import { Authorizer } from '../model/causal/Authorization'

import { MultiMap } from 'util/multimap';
import { Authorization, Verification } from '../model/causal/Authorization';
import { HashedSet } from '../model/immutable/HashedSet';

/*
 * CausalSet: A set with an explicit membership op that can be used by other objects as
 *            a causal dependency to prove that when something happened, this set contained
 *            a given element. When an element is deleted, an 'InvalidateAfterOp' is
 *            generated, causing any membership ops that were generated concurrently to be
 *            undone automatically, as well as any ops that have them as causal dependencies,
 *            by the cascading undo/redo mechanism.
 */

class AddOp<T> extends MutationOp {
    static className = 'hss/v0/CausalSet/AddOp';

    elmt?: T;

    constructor(targetObject?: CausalSet<T>, elmt?: T) {
        super(targetObject);

        this.elmt = elmt;
    }

    getClassName(): string {
        return AddOp.className;
    }

    init(): void {
        
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {
    
        return await super.validate(references) && this.elmt !== undefined; 
    }

    getElement() {
        return this.elmt as T;
    }
    
}

class DeleteOp<T> extends InvalidateAfterOp {
    static className = 'hss/v0/CausalSet/DeleteOp';

    constructor(targetOp?: AddOp<T>) {
        super(targetOp);
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
            console.log('addOp for MembershipAttestationOp ' + this.hash() + ' has a different target')
            return false;
        }

        if (this.targetOpNonCausalHash === undefined) {
            console.log('targetOpNonCausalHash is missing for MembershipAttestationOp ' + this.hash());
            return false;
        }

        return true;
    }
    
    getAddOp() {
        return this.getCausalOps().get('add-op') as AddOp<T>;
    }
}

abstract class CausalSet<T> extends MutableObject {

    
    static opClasses = [AddOp.className, DeleteOp.className, MembershipAttestationOp.className];

    acceptedTypes?: HashedSet<string>;
    acceptedElementHashes?: HashedSet<Hash>;
    
    _allElements: Map<Hash, T>;

    _currentAddOps        : Map<Hash, AddOp<T>>;
    _currentAddOpsPerElmt : MultiMap<Hash, Hash>;

    _validAddOpsPerElmt     : MultiMap<Hash, Hash>;
    _validDeleteOpsPerAddOp : MultiMap<Hash, Hash>;

    constructor(acceptedTypes?: Array<string>, acceptedElements?: Array<any>) {
        super(CausalSet.opClasses, true);

        this.setRandomId();

        if (acceptedTypes !== undefined) {
            this.acceptedTypes = new HashedSet<string>(acceptedTypes.values());
        }

        if (acceptedElements !== undefined) {
            this.acceptedElementHashes = new HashedSet<Hash>();
            for (const acceptedElement of acceptedElements.values()) {
                this.acceptedElementHashes.add(HashedObject.hashElement(acceptedElement));
            }
        }
        
        this._allElements = new Map();

        this._currentAddOps        = new Map();
        this._currentAddOpsPerElmt = new MultiMap();

        this._validAddOpsPerElmt     = new MultiMap();
        this._validDeleteOpsPerAddOp = new MultiMap();
    }

    protected async add(elmt: T, author?: Identity, extraAuth?: Authorizer): Promise<boolean> {
        
        const addOp = new AddOp(this, elmt);

        if (author !== undefined) {
            addOp.setAuthor(author);
        }

        const auth = Authorization.chain(this.createAddAuthorizer(elmt, author), extraAuth);

        this.setCurrentPrevOps(addOp);

        if (!(await auth.attempt(addOp))) {
                return false;
        }
        
        return this.applyNewOp(addOp).then(() => true);

    }

    protected async delete(elmt: T, author?: Identity, extraAuth?: Authorizer): Promise<boolean> {

        const hash = HashedObject.hashElement(elmt);
        
        return this.deleteByHash(hash, author, extraAuth);

    }

    protected async deleteByHash(hash: Hash, author?: Identity, extraAuth?: Authorizer): Promise<boolean> {
        
        const auth = Authorization.chain(this.createDeleteAuthorizerByHash(hash, author), extraAuth);

        return this.deleteByHashWithAuth(hash, auth, author, extraAuth);
    }

    private async deleteByHashWithAuth(hash: Hash, ourAuth: Authorizer, author?: Identity, extraAuth?: Authorizer): Promise<boolean> {

        const deleteOps: Array<DeleteOp<T>> = [];
        

        for (const addOpHash of this._currentAddOpsPerElmt.get(hash)) {
            const addOp = this._currentAddOps.get(addOpHash) as AddOp<T>;
            const deleteOp = new DeleteOp(addOp);
            if (author !== undefined) {
                deleteOp.setAuthor(author);
            }

            const auth = Authorization.chain(ourAuth, extraAuth);

            this.setCurrentPrevOps(deleteOp);

            if (!(await auth.attempt(deleteOp))) {
                return false;
            }
            
            deleteOps.push(deleteOp);
        }

        const deletions: Array<Promise<void>> = [];

        for (const deleteOp of deleteOps) {
            deletions.push(this.applyNewOp(deleteOp));
        }

        return Promise.all(deletions).then(() => deletions.length > 0);
    }

    protected has(elmt: T): boolean {
        return this.hasByHash(HashedObject.hashElement(elmt));
    }

    protected hasByHash(hash: Hash): boolean {
        return this._currentAddOpsPerElmt.get(hash).size > 0;
    }

    attestationKey(elmt: T) {
        return this.attestationKeyByHash(HashedObject.hashElement(elmt));
    }

    attestationKeyByHash(hash: Hash) {
        return 'CausalSet/attest:' + hash + '-belongs-to-' + this.hash();
    }

    protected async attestMembershipForOp(elmt: T, op: MutationOp): Promise<boolean> {

        const hash = HashedObject.hashElement(elmt);

        return this.attestMembershipForOpByHash(hash, op);
    }

    protected async attestMembershipForOpByHash(hash: Hash, op: MutationOp): Promise<boolean> {

        const addOpHashes = this._currentAddOpsPerElmt.get(hash);

        if (addOpHashes.size > 0) {
            const addOpHash = addOpHashes.values().next().value as Hash;
            const addOp     = this._currentAddOps.get(addOpHash) as AddOp<T>;

            const attestOp = new MembershipAttestationOp(addOp, op);

            await this.applyNewOp(attestOp);
            const key = this.attestationKeyByHash(hash);
            op.addCausalOp(key, attestOp);

            return true;
        } else {
            return false;
        }

    }

    protected verifyMembershipAttestationForOp(elmt: T, op: MutationOp, usedKeys: Set<string>): boolean {

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

        opReferences;

        if (!super.shouldAcceptMutationOp(op, opReferences)) {
            return false;
        }

        if (op instanceof AddOp || op instanceof DeleteOp) {
            const author = op.getAuthor();

            if (author === undefined) {
                return false;
            }

            const auth = (op instanceof AddOp) ?
                                            this.createAddAuthorizer(op.getElement(), author)
                                                        :
                                            this.createDeleteAuthorizerByHash(
                                                    HashedObject.hashElement(op.getAddOp().getElement()), author);;
                                                                                
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

        let addOp     : AddOp<T>|undefined;
        let addOpHash : Hash|undefined;
        let elmtHash  : Hash|undefined;

        if (op instanceof AddOp) {

            addOp     = op;
            addOpHash = addOp.hash();
            elmtHash  = HashedObject.hashElement(addOp.getElement());

            if (valid) {
                this._validAddOpsPerElmt.add(elmtHash, addOpHash);
            } else {
                this._validAddOpsPerElmt.delete(elmtHash, addOpHash);
            }
            
            if (!cascade) {
                this._allElements.set(elmtHash, addOp.elmt as T);
            }

        } else if (op instanceof DeleteOp) {

            const deleteOpHash = op.hash();

            addOp     = op.getTargetOp() as AddOp<T>;
            addOpHash = addOp.hash();
            elmtHash  = HashedObject.hashElement(addOp.getElement());

            if (valid) {
               this._validDeleteOpsPerAddOp.add(addOpHash, deleteOpHash);
            } else {
               this._validDeleteOpsPerAddOp.delete(addOpHash, deleteOpHash); 
            }

        } else {
            // do nothing
        }

        if (elmtHash !== undefined && addOp != undefined && addOpHash !== undefined) {

            if ( this._validAddOpsPerElmt.has(elmtHash, addOpHash) && 
                 this._validDeleteOpsPerAddOp.get(addOpHash).size === 0 ) {
        
                this._currentAddOps.set(addOpHash, addOp);
                this._currentAddOpsPerElmt.add(elmtHash, addOpHash);
            } else {
                this._currentAddOps.delete(addOpHash);
                this._currentAddOpsPerElmt.delete(elmtHash, addOpHash);
            }

            return true;
        } else {
            return false;
        }
    }

    init(): void {
        
    }

    protected createAddAuthorizer(elmt: T, _author?: Identity): Authorizer {

        if (this.acceptedElementHashes !== undefined && !this.acceptedElementHashes.has(HashedObject.hashElement(elmt))) {
            return Authorization.never;
        }

        if (this.acceptedTypes !== undefined && 
              !(
                (elmt instanceof HashedObject && this.acceptedTypes.has(elmt.getClassName())) 
                        ||
                (!(elmt instanceof HashedObject) && this.acceptedTypes.has(typeof(elmt)))
               )
                
        ) {

            return Authorization.never;

        }

        return Authorization.always;
    }

    // It's important to keep the two delete authorizer functions independent (by hash / by element)
    // so subclasses may redefine their behaviour separately.

    protected createDeleteAuthorizer(elmt: T, author?: Identity): Authorizer {
        return this.createDeleteAuthorizerByHash(HashedObject.hashElement(elmt), author);
    }

    protected createDeleteAuthorizerByHash(_elmtHash: Hash, _author?: Identity): Authorizer {
        return Authorization.always;
    }

    createMembershipAuthorizer(elmt: T): Authorizer {

        return {
            attempt : (op:  MutationOp) => this.attestMembershipForOp(elmt, op),
            verify  : (op: MutationOp, usedKeys: Set<string>) => this.verifyMembershipAttestationForOp(elmt, op, usedKeys)
        };

    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        references;

        if (this.acceptedElementHashes !== undefined && this.acceptedElementHashes.size() === 0) {
            return false;
        }

        if (this.acceptedTypes !== undefined && this.acceptedTypes.size() === 0) {
            return false;
        }

        return true;
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
}

HashedObject.registerClass(AddOp.className, AddOp);
HashedObject.registerClass(DeleteOp.className, DeleteOp);
HashedObject.registerClass(MembershipAttestationOp.className, MembershipAttestationOp);

export { CausalSet, AddOp as CausalSetAddOp, DeleteOp as CausalSetDeleteOp, MembershipAttestationOp as CausalSetMembershipAttestationOp };

