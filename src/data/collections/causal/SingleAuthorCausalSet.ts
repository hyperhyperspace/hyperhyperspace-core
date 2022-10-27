import { Identity } from '../../identity';
import { CausalSet } from './CausalSet';
import { Hash, HashedObject } from '../../model';
import { Authorization, Authorizer } from '../../model/causal/Authorization';

/*
 * --------- DEPRECATED ---------- DEPRECATED ------- DEPRECATED ----------------
 * 
 * THIS WAS DEEMED COMMON ENOUGH TO WARRANT THE CausalSet CLASS TO SUPPORT IT
 * DIRECTLY.
 *
 */ 

class SingleAuthorCausalSet<T> extends CausalSet<T> {

    static className = 'hss/v0/SingleAuthorCausalSet';

    constructor(author?: Identity, acceptedTypes?: Array<string>, acceptedElements?: Array<any>) {
        super({writer: author, acceptedTypes: acceptedTypes, acceptedElements: acceptedElements});

        

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


    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        
        if (!super.validate(references)) {
            return false;
        }

        return this.getAuthor() !== undefined;
    }

    protected createAddAuthorizer(author: Identity): Authorizer {

        if (author.equals(this.getAuthor())) {
            return Authorization.always;
        } else {
            return Authorization.never;
        }
    }

    protected createDeleteAuthorizerByHash(_elmtHash: Hash, author: Identity): Authorizer {

        if (author.equals(this.getAuthor())) {
            return Authorization.always;
        } else {
            return Authorization.never;
        }
    }

    getClassName() {
        return SingleAuthorCausalSet.className;
    }
}

HashedObject.registerClass(SingleAuthorCausalSet.className, SingleAuthorCausalSet);

export { SingleAuthorCausalSet };