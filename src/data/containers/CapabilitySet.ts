import { MultiMap } from 'util/multimap';

import { Hash, HashReference } from '../model';
import { Identity } from '../identity';
import { HashedObject, MutableObject, MutationOp, InvalidateAfterOp } from '../model';

type Capability = string;
type Key = string;

class GrantOp extends MutationOp {

    static className = 'hhs/v0/GrantCapabilityOp';

    grantee?    : Identity;
    capability? : Capability;

    constructor(targetObject?: CapabilitySet, grantee?: Identity, capability?: Capability, causalOps?: IterableIterator<MutationOp>) {
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

    static className = 'hhs/v0/RevokeCapabilityAfterOp';

    constructor(grantOp?: GrantOp, terminalOps?: IterableIterator<MutationOp>, causalOps?: IterableIterator<MutationOp>) {
        super(grantOp, terminalOps, causalOps);
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        return await super.validate(references) && this.getTargetOp() instanceof GrantOp;
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

    static className = 'hhs/v0/UseCapabilityOp';

    grantOp?: GrantOp;
    usageKey?: Hash;

    constructor(grantOp?: GrantOp, usageKey?: Hash) {
        super(grantOp?.getTargetObject(), grantOp === undefined? undefined : [grantOp].values());

        if (grantOp !== undefined) {
            this.grantOp = grantOp;
            this.usageKey = usageKey;
            this.setAuthor(grantOp.grantee as Identity);
        }
        
    }

    getClassName(): string {
        return UseOp.className;
    }

    init(): void {
        
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {
        if (!await super.validate(references)) {
            return false;
        }

        const causalOps = this.causalOps;

        if (causalOps === undefined) {
            return false;
        }

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

        if (this.grantOp === undefined || !(this.grantOp instanceof GrantOp)) {
            return false
        }

        if (!this.grantOp.equals(causalOp)) {
            return false;
        }

        return true;
        
    }

}

class CapabilitySet extends MutableObject {

    static className = 'hhs/v0/CapabilitySet';
    static opClasses = [GrantOp.className, RevokeAfterOp.className, UseOp.className];

    _grants  : MultiMap<Key, Hash>;
    _revokes : MultiMap<Hash, Hash>;

    _grantOps: Map<Hash, GrantOp>;

    constructor() {
        super(CapabilitySet.opClasses, true);

        this.setRandomId();

        this._grants  = new MultiMap();
        this._revokes = new MultiMap();

        this._grantOps = new Map();
    }

    getClassName(): string {
        return CapabilitySet.className;
    }

    init(): void {
        
    }

    async mutate(op: MutationOp): Promise<boolean> {

        let mutated = false;

        if (op instanceof GrantOp) {
            const key = CapabilitySet.getGranteeCapabilityKeyForOp(op);
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

    hasCapability(grantee: Identity, capability: Capability): boolean {

        let result = false;

        for (const grantHash of this._grants.get(CapabilitySet.getGranteeCapabilityKey(grantee, capability))) {
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

    useCapability(grantee: Identity, capability: Capability, usageKey: string): UseOp {

        let useOp = this.useCapabilityIfAvailable(grantee, capability, usageKey);

        if (useOp === undefined) {
            throw new Error(grantee + ' is trying to use capability ' + capability + ', but it is not available.');
        }

        return useOp;

    }

    useCapabilityIfAvailable(grantee: Identity, capability: Capability, usageKey: string): UseOp|undefined {
        let useOp: UseOp|undefined = undefined;

        const grantOp = this.findValidGrant(grantee, capability);

        if (grantOp !== undefined) {
            useOp = new UseOp(grantOp, usageKey);
            useOp.setAuthor(grantee);
            this.applyNewOp(useOp);
        }

        return useOp;
    }

    protected findValidGrant(grantee: Identity, capability: Capability): GrantOp|undefined {
        
        let chosenGrantOp: GrantOp|undefined = undefined;
        let chosenGrantOpHash: Hash|undefined = undefined;

        for (const grantOpHash of this._grants.get(CapabilitySet.getGranteeCapabilityKey(grantee, capability))) {
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

    protected findAllValidGrants(grantee: Identity, capability: Capability): Map<Hash, GrantOp> {
        
        const all = new Map<Hash, GrantOp>();

        for (const grantOpHash of this._grants.get(CapabilitySet.getGranteeCapabilityKey(grantee, capability))) {
            if (!this.isUndone(grantOpHash)) {
                let revoked = false;
                for (const revokeHash of this._revokes.get(grantOpHash)) {
                    if (!this.isUndone(revokeHash)) {
                        revoked = true;
                    }
                }

                if (!revoked) {
                    all.set(grantOpHash, this._grantOps.get(grantOpHash) as GrantOp);
                }
            }
        }

        return all;
    }

    static getGranteeCapabilityKeyForOp(op: GrantOp|RevokeAfterOp): Key {

        let revoke = false;

        if (op instanceof RevokeAfterOp) {
            op = op.getTargetOp();
            revoke = true;
        }

        return CapabilitySet.getGranteeCapabilityKey(op.grantee as Identity, op.capability as Capability, revoke);
    }

    static getGranteeCapabilityKey(grantee: Identity, capability: Capability, revoke=false): Key {
        return (revoke? 'revoke' : 'grant') + '-' + grantee.hash().replace(/-/g, '--') + '-' + capability.replace(/-/g, '--');
    }
}

HashedObject.registerClass(CapabilitySet.className, CapabilitySet);
HashedObject.registerClass(GrantOp.className, GrantOp);
HashedObject.registerClass(RevokeAfterOp.className, RevokeAfterOp);
HashedObject.registerClass(UseOp.className, UseOp);
    


export { CapabilitySet, Capability, UseOp, GrantOp, RevokeAfterOp };