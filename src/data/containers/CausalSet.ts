import { Identity } from '../identity';
import { Hash, HashedObject } from '../model';
import { MutableObject, MutationOp, InvalidateAfterOp } from '../model';
import { Authorizer } from '../model/Authorization'

import { MultiMap } from 'util/multimap';
import { CascadedInvalidateOp } from 'data/model/CascadedInvalidateOp';

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
    
}

class MembershipAttestationOp<T> extends MutationOp {
    static className = 'hhs/v0/CausalSet/MembershipAttestationOp';

    addOp?: AddOp<T>;
    targetOpNonCausalHash?: Hash;

    constructor(addOp?: AddOp<T>, targetOp?: MutationOp) {
        super(addOp?.getTargetObject());

        if (addOp !== undefined) {
            this.addOp = addOp;

            if (targetOp === undefined) {
                throw new Error('Attempted to construct a CausalSet MembershipOp, but no targetOp was provided.');
            }

            this.addCausalOp(addOp);

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

        if (this.addOp === undefined || !(this.addOp instanceof AddOp)) {
            CausalSet.validationLog.debug('addOp is missing from MembershipAttestationOp ' + this.hash())
            return false;
        }

        if (!this.addOp.getTargetObject().equals(this.getTargetObject())) {
            console.log('addOp for MembershipAttestationOp ' + this.hash() + ' has a different target')
            return false;
        }

        if (this.targetOpNonCausalHash === undefined) {
            console.log('targetOpNonCausalHash is missing for MembershipAttestationOp ' + this.hash());
            return false;
        }

        return true;
    }
    
}

class CausalSet<T> extends MutableObject {

    static className = 'hss/v0/CausalSet';
    static opClasses = [AddOp.className, DeleteOp.className, MembershipAttestationOp.className];

    _allElements: Map<Hash, T>;

    _currentAddOps        : Map<Hash, AddOp<T>>;
    _currentAddOpsPerElmt : MultiMap<Hash, Hash>;

    _validAddOpsPerElmt     : MultiMap<Hash, Hash>;
    _validDeleteOpsPerAddOp : MultiMap<Hash, Hash>;

    constructor() {
        super(CausalSet.opClasses, true);

        this.setRandomId();
        
        this._allElements = new Map();

        this._currentAddOps        = new Map();
        this._currentAddOpsPerElmt = new MultiMap();

        this._validAddOpsPerElmt     = new MultiMap();
        this._validDeleteOpsPerAddOp = new MultiMap();
    }

    async add(elmt: T, author?: Identity, authorizer?: Authorizer): Promise<boolean> {
        
        const addOp = new AddOp(this, elmt);

        if (author !== undefined) {
            addOp.setAuthor(author);
        }

        if (authorizer !== undefined) {
            this.setCurrentPrevOps(addOp);

            if (!(await authorizer(addOp))) {
                return false;
            }
        }

        return this.applyNewOp(addOp).then(() => true);

    }

    async delete(elmt: T, author?: Identity, authorizer?: Authorizer): Promise<boolean> {

        const hash = HashedObject.hashElement(elmt);
        
        return this.deleteByHash(hash, author, authorizer);

    }

    async deleteByHash(hash: Hash, author?: Identity, authorizer?: Authorizer): Promise<boolean> {

        const deleteOps: Array<DeleteOp<T>> = [];
        const deletions: Array<Promise<void>> = [];

        for (const addOpHash of this._currentAddOpsPerElmt.get(hash)) {
            const addOp = this._currentAddOps.get(addOpHash) as AddOp<T>;
            const deleteOp = new DeleteOp(addOp);
            if (author !== undefined) {
                deleteOp.setAuthor(author);
            }
            if (authorizer !== undefined) {
                if (!(authorizer(deleteOp))) {
                    return false;
                }
            }
            deleteOps.push(deleteOp);
        }

        for (const deleteOp of deleteOps) {
            deletions.push(this.applyNewOp(deleteOp));
        }

        return Promise.all(deletions).then(() => deletions.length > 0);
    }

    has(elmt: T): boolean {
        return this.hasByHash(HashedObject.hashElement(elmt));
    }

    hasByHash(hash: Hash): boolean {
        return this._currentAddOpsPerElmt.get(hash).size > 0;
    }

    async attestMembershipForOp(elmt: T, op: MutationOp): Promise<boolean> {

        const hash = HashedObject.hashElement(elmt);

        return this.attestMembershipForOpByHash(hash, op);
    }

    async attestMembershipForOpByHash(hash: Hash, op: MutationOp): Promise<boolean> {

        const addOpHashes = this._currentAddOpsPerElmt.get(hash);

        if (addOpHashes.size > 0) {
            const addOpHash = addOpHashes.values().next().value as Hash;
            const addOp     = this._currentAddOps.get(addOpHash) as AddOp<T>;

            const attestOp = new MembershipAttestationOp(addOp, op);

            await this.applyNewOp(attestOp);
            op.addCausalOp(attestOp);

            return true;
        } else {
            return false;
        }

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

    getClassName(): string {
        return CausalSet.className;
    }

    init(): void {
        
    }

    shouldAcceptMutationOp(op: MutationOp, opReferences: Map<Hash, HashedObject>): boolean {

        opReferences;
        
        if (!this.isAcceptedMutationOpClass(op)) {
            CausalSet.validationLog.debug('Trying to apply op of type ' + op?.getClassName() + ', but it is not an accepted mutation type for ' + this.hash() + ' (' + this.getClassName() + ')');
            return false;
        }

        const owner = this.getAuthor();

        if (!(op instanceof MembershipAttestationOp || op instanceof CascadedInvalidateOp) && owner !== undefined && !owner.equals(op.getAuthor())) {
            CausalSet.validationLog.debug('Op ' + op?.hash() + ' of class ' + op?.getClassName() + ' has the wrong owner');
            return false;
        }

        return true;
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        references;
        
        return true; // TODO 
    }
}

HashedObject.registerClass(AddOp.className, AddOp);
HashedObject.registerClass(DeleteOp.className, DeleteOp);
HashedObject.registerClass(MembershipAttestationOp.className, MembershipAttestationOp);
HashedObject.registerClass(CausalSet.className, CausalSet);

export { CausalSet, Authorizer };
