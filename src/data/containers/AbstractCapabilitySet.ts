import { MultiMap } from 'util/multimap';

import { Hash } from '../model';
import { Identity } from '../identity';
import { HashedObject, MutableObject, MutationOp, InvalidateAfterOp } from '../model';

type Capability = string;
type Key = string;

class GrantCapabilityOp extends MutationOp {

    static className = 'hhs/v0/GrantCapabilityOp';

    grantee?    : Identity;
    capability? : Capability;

    constructor(targetObject?: AbstractCapabilitySet, grantee?: Identity, capability?: Capability) {
        super(targetObject);

        this.grantee = grantee;
        this.capability = capability;
 
    }
    
    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        return await super.validate(references) && this.grantee !== undefined && this.capability !== undefined;
    }

    getClassName(): string {
        return GrantCapabilityOp.className;
    }

    init(): void {
        
    }

}

class RevokeCapabilityAfterOp extends InvalidateAfterOp {

    static className = 'hhs/v0/RevokeCapabilityAfterOp';

    constructor(grantOp?: GrantCapabilityOp) {
        super(grantOp);
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        return await super.validate(references) && this.getTargetOp() instanceof GrantCapabilityOp;
    }

    getTargetOp(): GrantCapabilityOp {
        return super.getTargetOp() as GrantCapabilityOp;
    }

    getClassName(): string {
        return RevokeCapabilityAfterOp.className;
    }

    init(): void {
        
    }

}

class UseCapabilityOp extends MutationOp {

    static className = 'hhs/v0/UseCapabilityOp';

    grantOp?: GrantCapabilityOp;
    usageKey?: Hash;

    constructor(grantOp?: GrantCapabilityOp, usageKey?: Hash) {
        super(grantOp?.getTargetObject());

        if (grantOp !== undefined) {
            this.grantOp = grantOp;
            this.usageKey = usageKey;
            this.setAuthor(grantOp.grantee as Identity);

            this.setCausalOps([grantOp].values());
        }
        
    }

    getClassName(): string {
        return UseCapabilityOp.className;
    }

    init(): void {
        
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {
        if (!await super.validate(references)) {
            return false;
        }

        if (this.getId() !== undefined) {
            return false;
        }

        const causalOps = this.causalOps;

        if (causalOps === undefined) {
            return false;
        }

        if (causalOps.size() !== 1) {
            return false;
        }

        const causalOp = causalOps.values().next().value as MutationOp;

        if (causalOp === undefined) {
             return false;
        }

        if (!(causalOp instanceof GrantCapabilityOp)) {
            return false;
        }

        if (!(causalOp.getTargetObject().equals(this.getTargetObject()))) {
            return false;
        }

        if (!(causalOp.grantee !== undefined && causalOp.grantee.equals(this.getAuthor()))) {
            return false;
        }

        if (this.grantOp === undefined || !(this.grantOp instanceof GrantCapabilityOp)) {
            return false
        }

        if (!this.grantOp.equals(causalOp)) {
            return false;
        }

        return true;
        
    }

}

abstract class AbstractCapabilitySet extends MutableObject {

    static opClasses = [GrantCapabilityOp.className, RevokeCapabilityAfterOp.className, UseCapabilityOp.className];

    _grants  : MultiMap<Key, Hash>;
    _revokes : MultiMap<Hash, Hash>;

    _grantOps: Map<Hash, GrantCapabilityOp>;

    constructor() {
        super(AbstractCapabilitySet.opClasses, true);

        this.setRandomId();

        this._grants  = new MultiMap();
        this._revokes = new MultiMap();

        this._grantOps = new Map();
    }

    init(): void {
        
    }

    async mutate(op: MutationOp, valid: boolean, cascade: boolean): Promise<boolean> {

        let mutated = false;

        if (valid && !cascade) {
            if (op instanceof GrantCapabilityOp) {
                const key = AbstractCapabilitySet.getGranteeCapabilityKeyForOp(op);
                const hash = op.hash();
                this._grants.add(key, hash);
                this._grantOps.set(hash, op);
            } else if (op instanceof RevokeCapabilityAfterOp) {
                const grantOp = op.getTargetOp();
                this._revokes.add(grantOp.hash(), op.hash());
            }
        }
        

        return mutated;
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        references;

        return true;
    }

    hasCapability(grantee: Identity, capability: Capability): boolean {

        let result = false;

        for (const grantHash of this._grants.get(AbstractCapabilitySet.getGranteeCapabilityKey(grantee, capability))) {
            if (this.isValidOp(grantHash)) {
                let revoked = false;
                for (const revokeHash of this._revokes.get(grantHash)) {
                    if (this.isValidOp(revokeHash)) {
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

    useCapability(grantee: Identity, capability: Capability, usageKey: string): UseCapabilityOp {

        let useOp = this.useCapabilityIfAvailable(grantee, capability, usageKey);

        if (useOp === undefined) {
            throw new Error(grantee + ' is trying to use capability ' + capability + ', but it is not available.');
        }

        return useOp;

    }

    useCapabilityIfAvailable(grantee: Identity, capability: Capability, usageKey: string): UseCapabilityOp|undefined {
        let useOp: UseCapabilityOp|undefined = undefined;

        const grantOp = this.findValidGrant(grantee, capability);

        if (grantOp !== undefined) {
            useOp = new UseCapabilityOp(grantOp, usageKey);
            useOp.setAuthor(grantee);
            this.applyNewOp(useOp);
        }

        return useOp;
    }

    useCapabilityForOp(grantee: Identity, capability: Capability, op: MutationOp): UseCapabilityOp {
        const usageKey = op.nonCausalHash();
        const useOp = this.useCapability(grantee, capability, usageKey);
        op.addCausalOp(useOp);
        return useOp;
    }

    useCapabilityForOpIfAvailable(grantee: Identity, capability: Capability, op: MutationOp): UseCapabilityOp|undefined {
        const usageKey = op.nonCausalHash();
        const useOp = this.useCapabilityIfAvailable(grantee, capability, usageKey);
        if (useOp !== undefined) {
            op.addCausalOp(useOp);
            return useOp;
        } else {
            return undefined;
        }
    }

    checkCapabilityForOp(useOp: UseCapabilityOp, capability: Capability, op: MutationOp, grantee?: Identity): boolean {
        const usageKey = op.nonCausalHash();
        if (useOp.usageKey !== usageKey) {
            return false;
        }

        if (useOp.grantOp?.capability !== capability) {
            return false;
        }

        if (!op.hasCausalOps() || !op.getCausalOps().has(useOp)) {
            return false;
        }

        if (grantee !== undefined && !grantee.equals(useOp.getAuthor())) {
            return false;
        }

        return true;
    }

    isCapabilityUseForOp(op: MutationOp, useOp: UseCapabilityOp): boolean {
        return useOp.usageKey === op.nonCausalHash();
    }

    protected findValidGrant(grantee: Identity, capability: Capability): GrantCapabilityOp|undefined {
        
        let chosenGrantOp: GrantCapabilityOp|undefined = undefined;
        let chosenGrantOpHash: Hash|undefined = undefined;

        for (const grantOpHash of this._grants.get(AbstractCapabilitySet.getGranteeCapabilityKey(grantee, capability))) {
            if (this.isValidOp(grantOpHash)) {
                let revoked = false;
                for (const revokeHash of this._revokes.get(grantOpHash)) {
                    if (this.isValidOp(revokeHash)) {
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

    protected findAllValidGrants(grantee: Identity, capability: Capability): Map<Hash, GrantCapabilityOp> {
        
        const all = new Map<Hash, GrantCapabilityOp>();

        for (const grantOpHash of this._grants.get(AbstractCapabilitySet.getGranteeCapabilityKey(grantee, capability))) {
            if (this.isValidOp(grantOpHash)) {
                let revoked = false;
                for (const revokeHash of this._revokes.get(grantOpHash)) {
                    if (this.isValidOp(revokeHash)) {
                        revoked = true;
                    }
                }

                if (!revoked) {
                    all.set(grantOpHash, this._grantOps.get(grantOpHash) as GrantCapabilityOp);
                }
            }
        }

        return all;
    }

    findAllCurrentGrantees(_capability: Capability) {
        
    }

    static getGranteeCapabilityKeyForOp(op: GrantCapabilityOp|RevokeCapabilityAfterOp): Key {

        let revoke = false;

        if (op instanceof RevokeCapabilityAfterOp) {
            op = op.getTargetOp();
            revoke = true;
        }

        return AbstractCapabilitySet.getGranteeCapabilityKey(op.grantee as Identity, op.capability as Capability, revoke);
    }

    static getGranteeCapabilityKey(grantee: Identity, capability: Capability, revoke=false): Key {
        return (revoke? 'revoke' : 'grant') + '-' + grantee.hash().replace(/-/g, '--') + '-' + capability.replace(/-/g, '--');
    }
}

HashedObject.registerClass(GrantCapabilityOp.className, GrantCapabilityOp);
HashedObject.registerClass(RevokeCapabilityAfterOp.className, RevokeCapabilityAfterOp);
HashedObject.registerClass(UseCapabilityOp.className, UseCapabilityOp);
    


export { AbstractCapabilitySet, Capability, UseCapabilityOp, GrantCapabilityOp, RevokeCapabilityAfterOp };