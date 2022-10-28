import { MutableObjectConfig, MutationOp } from '../../model/mutable';
import { Identity } from '../../identity';
import { Hash} from '../../model/hashing'
import { Authorization, Authorizer } from 'data/model';
import { BaseCollection, CollectionConfig } from '../mutable/Collection';

class AuthError extends Error {

};

interface CausalCollection<T> {
    has(elmt: T): boolean;
    hasByHash(hash: Hash): boolean;

    attestMembershipForOp(elmt: T, op: MutationOp): Promise<boolean>;
    attestMembershipForOpByHash(hash: Hash, op: MutationOp): Promise<boolean>;

    verifyMembershipAttestationForOp(elmt: T, op: MutationOp, usedKeys: Set<string>): boolean;

    createMembershipAuthorizer(elmt: T): Authorizer;
}

type CausalCollectionConfig = CollectionConfig & {
    mutableWriters?: CausalCollection<Identity>
};

// Note: the validation of writing rights in BaseCollection is delegated to the validate
//       function of the class CollectionOp. In the causal case, we don't use a base class
//       for ops (they may be derived either from MutationOp or InvalidateAfterOp, so a 
//       single base class would be unfeasible anyway). Instead, the createWriteAuthorizer()
//       method creates an Authorizer that takes the causal colleciton's write configuration
//       and checks whether it is honored by an op.

abstract class BaseCausalCollection<T> extends BaseCollection<T> {
    
    // Adds a mutable causal collection of authorized writers to what we had in BaseCollection:
    mutableWriters? : CausalCollection<Identity>;

    // For someone to have write access they must either be in BaseCollection's immutable writers 
    // set, or attest that they belong to the causal collection of writers. If both are missing, 
    // then the writing permissions have no effect, and anyone can write.

    constructor(acceptedOpClasses : Array<string>, config?: MutableObjectConfig & CausalCollectionConfig) {
        super(acceptedOpClasses, config);

        if (config?.mutableWriters !== undefined) {
            this.mutableWriters = config?.mutableWriters;
        }
    }

    // Note: since mutableWriters may be any implementation of CausalCollection,
    //       we cannot check its integrity here. The app should check that it is
    //       the right collection if it is present anyway.

    // (Hence we just rely on Collection's validate function.)

    hasMutableWriters() {
        return this.mutableWriters !== undefined;
    }

    getMutableWriters(): CausalCollection<Identity> {

        if (!this.hasMutableWriters()) {
            throw new Error('This collections has no mutable writers')
        }

        return this.mutableWriters as CausalCollection<Identity>;
    }

    protected createWriteAuthorizer(author?: Identity): Authorizer {

        if (this.writers === undefined && this.mutableWriters === undefined) {
            return Authorization.always;
        } else if (this.writers !== undefined && author !== undefined && this.writers.has(author)) {
            return Authorization.always;
        } else if (this.mutableWriters !== undefined && author !== undefined) { 
            return this.mutableWriters.createMembershipAuthorizer(author);
        } else {
            return Authorization.never;
        }
    }
}


export { CausalCollection, BaseCausalCollection, AuthError };
export type { CausalCollectionConfig };