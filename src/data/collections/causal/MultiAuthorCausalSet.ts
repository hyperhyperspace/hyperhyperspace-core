import { Identity } from 'data/identity';
import { HashedObject } from 'data/model';
import { Authorizer } from 'data/model';
import { CausalSet } from './CausalSet';

/**
 * 
 * --------- DEPRECATED ---------- DEPRECATED ------- DEPRECATED ----------------
 * 
 * THIS WAS DEEMED COMMON ENOUGH TO WARRANT THE CausalSet CLASS TO SUPPORT IT
 * DIRECTLY.
 * 
 * A CausalSet, equipped with a set of authorized identities that can modify it.
 * 
 * As-is, anyone that is in the "authorized" set can add/delete elements. This class can be
 * subclassed to add or modify that rule. There are two extension points:
 * 
 * - Override createAddAuthorizerFor and createDeleteAuthorizerFor: this is the simplest way.
 * 
 * - Use the extraAuth parameter that add/delete receive for maximum flexibility. In this case,
 *   the authorization is not constrained to the params that the two functions above receive:
 *   parameters that are only known to the subclass may be used to create extraAuth. The downside
 *   is that shouldAcceptMutationOp will have to be completely overriden to match the extraAuth
 *   behaviour.
 *   
 */

class MultiAuthorCausalSet<T> extends CausalSet<T> {

    static className = 'hss/v0/MultiAuthorCausalSet';

    constructor(authorized?: CausalSet<Identity>, acceptedTypes?: Array<string>, acceptedElements?: Array<any>) {
        super({mutableWriters: authorized, acceptedTypes: acceptedTypes, acceptedElements: acceptedElements});
    }

    getClassName(): string {
        return MultiAuthorCausalSet.className;
    }

    add(elmt: T, author: Identity, extraAuth?: Authorizer): Promise<boolean> {
        return super.add(elmt, author, extraAuth);
    }

    delete(elmt: T, author: Identity, extraAuth?: Authorizer): Promise<boolean> {
        return super.delete(elmt, author, extraAuth);
    }

    getAuthorizedIdentitiesSet() {
        return this.mutableWriters as CausalSet<Identity>;
    }
}

HashedObject.registerClass(MultiAuthorCausalSet.className, MultiAuthorCausalSet);

export { MultiAuthorCausalSet };