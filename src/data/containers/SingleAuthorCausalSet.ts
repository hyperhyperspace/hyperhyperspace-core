import { Identity } from '../identity';
import { CausalSet } from '../containers';
import { Hash, HashedObject, MutationOp, CascadedInvalidateOp } from '../model';

import { CausalSetMembershipAttestationOp } from './CausalSet';


class SingleAuthorCausalSet<T> extends CausalSet<T> {

    static className = 'hss/v0/SingleAuthorCausalSet';

    constructor(author?: Identity) {
        super();

        if (author !== undefined) {
            this.setAuthor(author);
        }
    }

    async add(elmt: T): Promise<boolean> {

        return super.add(elmt, this.getAuthor());
    }

    async delete(elmt: T): Promise<boolean> {

        return super.delete(elmt, this.getAuthor());
    }

    async deleteByHash(hash: Hash): Promise<boolean> {

        return super.deleteByHash(hash, this.getAuthor());
    }

    has(elmt: T): boolean {
        return super.has(elmt);
    }

    hasByHash(hash: Hash): boolean {
        return super.hasByHash(hash);
    }

    shouldAcceptMutationOp(op: MutationOp, opReferences: Map<Hash, HashedObject>): boolean {

        opReferences;
        
        if (!this.isAcceptedMutationOpClass(op)) {
            SingleAuthorCausalSet.validationLog.debug('Trying to apply op of type ' + op?.getClassName() + ', but it is not an accepted mutation type for ' + this.hash() + ' (' + this.getClassName() + ')');
            return false;
        }

        const owner = this.getAuthor();

        if (!(op instanceof CausalSetMembershipAttestationOp || op instanceof CascadedInvalidateOp) && owner !== undefined && !owner.equals(op.getAuthor())) {
            CausalSet.validationLog.debug('Op ' + op?.hash() + ' of class ' + op?.getClassName() + ' has the wrong owner');
            return false;
        }

        return true;
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        
        references;

        return this.getAuthor() !== undefined;
    }

    getClassName() {
        return SingleAuthorCausalSet.className;
    }
}

HashedObject.registerClass(SingleAuthorCausalSet.className, SingleAuthorCausalSet);

export { SingleAuthorCausalSet };