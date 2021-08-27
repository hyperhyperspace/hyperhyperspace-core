import { Identity } from 'data/identity';
import { Hash, HashedObject, HashReference, InvalidateAfterOp, MutableObject, MutationOp } from 'data/model';
import { MultiMap } from 'util/multimap';

type PermissionTestOp = GrantOp|RevokeAfterOp|UseOp;

type PermissionUse = UseOp;

type Capability = string;
type Key = string;


class GrantOp extends MutationOp {

    static className = 'hhs-test/GrantOp';

    grantee?    : Identity;
    capability? : Capability;

    constructor(targetObject?: PermissionTest, grantee?: Identity, capability?: Capability, causalOps?: IterableIterator<MutationOp>) {
        super(targetObject, causalOps);

        this.grantee = grantee;
        this.capability = capability;

    }
    
    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        return await super.validate(references) && this.grantee !== undefined && this.capability !== undefined;
    }

    getClassName(): string {
        return GrantOp.className;
    }

    init(): void {
        
    }

}

class RevokeAfterOp extends InvalidateAfterOp {

    static className = 'hhs-test/RevokeOp';

    constructor(grantOp?: GrantOp, terminalOps?: IterableIterator<PermissionTestOp>, causalOps?: IterableIterator<MutationOp>) {
        super(grantOp, terminalOps, causalOps);
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        return await super.validate(references) && this.getTargetOp() instanceof GrantOp && this.getTargetOp().getTargetObject().equals(this.getTargetObject());
    }

    getTargetOp(): GrantOp {
        return super.getTargetOp() as GrantOp;
    }

    getClassName(): string {
        return RevokeAfterOp.className;
    }

    init(): void {
        
    }

}

class UseOp extends MutationOp {

    static className = 'hhs-test/UseOp';

    constructor(op?: GrantOp) {
        super(op?.getTargetObject(), op === undefined? undefined : [op].values());
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {

        if (!await super.validate(references)) {
            return false;
        }

        const causalOps = this.getCausalOps();

        if (causalOps.size() !== 1) {
            return false;
        }

        const causalOpRef = causalOps.values().next().value as HashReference<MutationOp>;
        const causalOp = references.get(causalOpRef.hash);

        if (causalOp === undefined) {
             return false;
        }

        if (!(causalOp instanceof GrantOp)) {
            return false;
        }

        if (!(causalOp.getTargetObject().equals(this.getTargetObject()))) {
            return false;
        }

        if (!(causalOp.grantee !== undefined && causalOp.grantee.equals(this.getAuthor()))) {
            return false;
        }

        return true;
    }

    getClassName(): string {
        return UseOp.className;
    }

    init(): void {
        
    }

}


class PermissionTest extends MutableObject {

    static className = 'hhs-test/PermissionTest';
    static opClasses = [GrantOp.className, RevokeAfterOp.className, UseOp.className];

    _grants  : MultiMap<Key, Hash>;
    _revokes : MultiMap<Hash, Hash>;

    _grantOps: Map<Hash, GrantOp>;

    constructor() {
        super(PermissionTest.opClasses, true);

        this._grants  = new MultiMap();
        this._revokes = new MultiMap();

        this._grantOps = new Map();
    }

    getClassName(): string {
        return PermissionTest.className;
    }

    init(): void {
        
    }

    private isRootOp(op: MutationOp): boolean { 
        const root = this.getAuthor();

        return root !== undefined && root.equals(op.getAuthor()) && op.getCausalOps().size() === 0;
    }

    private isAdminOp(op: MutationOp): boolean {

        const causalOps = op.getCausalOps();
        if (causalOps.size() !== 1) {
            return false;
        }

        const causalOp = causalOps.values().next().value as MutationOp;

        if (!(causalOp instanceof GrantOp) || !this.isRootOp(causalOp)) {
            return false;
        }

        if (!(causalOp.grantee !== undefined  && causalOp.grantee.equals(op.getAuthor()))) {
            return false;
        }

        if (causalOp.capability !== 'admin') {
            return false;
        }

        return true;

    }

    shouldAcceptMutationOp(op: MutationOp): boolean {

        if (super.shouldAcceptMutationOp(op)) {

            if (op instanceof GrantOp) {
                if (op.capability === 'admin' && this.isRootOp(op)) {
                    return true;
                } else if (op.capability === 'user' && (this.isRootOp(op) || this.isAdminOp(op))) {
                    return true;
                } else {
                    return false;
                }
            } else if (op instanceof RevokeAfterOp) {
                if (op.getTargetOp().capability === 'admin' && this.isRootOp(op)) {
                    return true;
                } else if (op.getTargetOp().capability === 'user' && (this.isRootOp(op) || this.isAdminOp(op))) {
                    return true;
                } else {
                    return false;
                }
            } else {
                return true
            }

    
        } else {
            return false;
        }


    }

    async mutate(op: MutationOp): Promise<boolean> {

        let mutated = false;

        if (op instanceof GrantOp) {
            const key = PermissionTest.getGranteeCapabilityKeyForGrantOp(op);
            const hash = op.hash();
            this._grants.add(key, hash);
            this._grantOps.set(hash, op);
        } else if (op instanceof RevokeAfterOp) {
            const grantOp = op.getTargetOp();
            this._revokes.add(grantOp.hash(), op.hash());
        }

        return mutated;
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        references;

        return true;
    }

    /*shouldAcceptMutationOp(op: MutationOp) {

        let accept = super.shouldAcceptMutationOp(op);

        if (accept && )

        return accept;

    }*/

    hasCapability(grantee: Identity, capability: Capability): boolean {

        let result = false;

        for (const grantHash of this._grants.get(PermissionTest.getGranteeCapabilityKey(grantee, capability))) {
            if (!this.isUndone(grantHash)) {
                let revoked = false;
                for (const revokeHash of this._revokes.get(grantHash)) {
                    if (!this.isUndone(revokeHash)) {
                        revoked = true;
                    }
                }

                if (!revoked) {
                    result = true;
                    break;
                }
            }
        }

        return result;
    }

    useCapability(grantee: Identity, capability: Capability): UseOp {

        let useOp = this.useCapabilityIfAvailable(grantee, capability);

        if (useOp === undefined) {
            throw new Error(grantee + ' is trying to use capability ' + capability + ', but it is not available.');
        }

        return useOp;

    }

    useCapabilityIfAvailable(grantee: Identity, capability: Capability): UseOp|undefined {
        let useOp: UseOp|undefined = undefined;

        const grantOp = this.findValidGrant(grantee, capability);

        if (grantOp !== undefined) {
            useOp = new UseOp(grantOp);
            this.applyNewOp(useOp);
        }

        return useOp;
    }

    private findValidGrant(grantee: Identity, capability: Capability): GrantOp|undefined {
        
        let chosenGrantOp: GrantOp|undefined = undefined;
        let chosenGrantOpHash: Hash|undefined = undefined;

        for (const grantOpHash of this._grants.get(PermissionTest.getGranteeCapabilityKey(grantee, capability))) {
            if (!this.isUndone(grantOpHash)) {
                let revoked = false;
                for (const revokeHash of this._revokes.get(grantOpHash)) {
                    if (!this.isUndone(revokeHash)) {
                        revoked = true;
                    }
                }

                if (!revoked) {
                    if (chosenGrantOpHash === undefined || grantOpHash.localeCompare(chosenGrantOpHash) < 0) {
                        chosenGrantOpHash = grantOpHash;
                        chosenGrantOp = this._grantOps.get(grantOpHash);
                    }
                }
            }
        }

        return chosenGrantOp;
    }

    static getGranteeCapabilityKeyForGrantOp(op: GrantOp): Key {
        return PermissionTest.getGranteeCapabilityKey(op.grantee as Identity, op.capability as Capability);
    }

    static getGranteeCapabilityKey(grantee: Identity, capability: Capability): Key {
        return grantee.hash().replace(/-/g, '--') + '-' + capability.replace(/-/g, '--');
    }

}

HashedObject.registerClass(PermissionTest.className, PermissionTest);
HashedObject.registerClass(GrantOp.className, GrantOp);
HashedObject.registerClass(RevokeAfterOp.className, RevokeAfterOp);
HashedObject.registerClass(UseOp.className, UseOp);

export { PermissionTest, PermissionUse };