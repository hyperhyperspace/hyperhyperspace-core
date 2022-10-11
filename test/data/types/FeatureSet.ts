import { CausalSet, SingleAuthorCausalSet, CausalSetAddOp, CausalSetDeleteOp } from 'data/collections';
import { Identity } from 'data/identity';
import { Hash, HashedObject, MutationOp } from 'data/model';
import { Authorizer, Authorization } from 'data/model';
import { Verification } from 'data/model/causal/Authorization';

type Feature = string;

class FeatureSet extends CausalSet<Feature> {

    static className = 'hhs-test/FeatureSet';

    authorized?: SingleAuthorCausalSet<Identity>;
    features?: Array<Feature>;

    constructor(authorized?: SingleAuthorCausalSet<Identity>, features?: Array<Feature>) {
        super();

        if (authorized !== undefined) {
            this.setRandomId();

            this.authorized = authorized;
            this.features   = features;    
        }

    }

    getClassName(): string {
        return FeatureSet.className;
    }

    async enable(feature: Feature, author: Identity): Promise<boolean> {

        if (this.features !== undefined && this.features.indexOf(feature) < 0) {
            throw new Error('Cannot enable feature ' + feature + ', accepted features are: ' + this.features);
        }

        const auth = this.createAuthorizerFor(author);

        try {            
            return await super.add(feature, author, auth);
        } catch (e) {
            return false;
        }
    }

    async disable(feature: Feature, author: Identity): Promise<boolean> {

        if (this.features !== undefined && this.features.indexOf(feature) < 0) {
            throw new Error('Cannot disable feature ' + feature + ', accepted features are: ' + this.features);
        }

        const auth = this.createAuthorizerFor(author);

        try {
            return await super.delete(feature, author, auth);
        } catch (e) {
            return false;
        }
    }

    async disableByHash(hash: Hash, author: Identity): Promise<boolean> {

        const auth = this.createAuthorizerFor(author);

        try {
            return super.deleteByHash(hash, author, auth);
        } catch (e) {
            return false;
        }
        
    }

    isEnabled(feature: Feature) {
        return this.has(feature);
    }

    isEnabledByHash(hash: Hash) {
        return this.hasByHash(hash);
    }

    protected createAuthorizerFor(author: Identity): Authorizer {

        const owner = this.authorized?.getAuthor();

        if (author.equals(owner)) {
            return Authorization.always;
        } else {
            return this.getAuthorizedIdentitiesSet().createMembershipAuthorizer(author);
        }
    }

    getAuthorizedIdentitiesSet() {
        return this.authorized as CausalSet<Identity>;
    }

    shouldAcceptMutationOp(op: MutationOp, opReferences: Map<Hash, HashedObject>): boolean {

        opReferences;
        
        if (!this.isAcceptedMutationOpClass(op)) {
            FeatureSet.validationLog.debug(op?.getClassName() + ' is not an accepted op for ' + this.getClassName());
            return false;
        }


        if (op instanceof CausalSetAddOp || op instanceof CausalSetDeleteOp) {

            const owner = this.getAuthor();


            const opAuthor = op.getAuthor();
            if (opAuthor === undefined) {
                FeatureSet.validationLog.debug('Addition and deletion ops on a FeatureSet must have an author')
                return false;
            }

            if (owner === undefined || !owner.equals(opAuthor)) {

                const auth = this.createAuthorizerFor(opAuthor);
                const usedKeys = new Set<string>();

                if (!(auth.verify(op, usedKeys)) ) {
                    return false
                }

                if (!Verification.checkKeys(usedKeys, op)) {
                    return false;
                }
            }
    
        }


        

        return true;
    }

    async validate(references: Map<string, HashedObject>) {

        references;

        if (this.authorized === undefined || !(this.authorized instanceof CausalSet)) {
            return false;
        }

        if (!Array.isArray(this.features)) {
            return false;
        }

        for (const feature of this.features as any as Array<any>) {
            if (typeof feature !== 'string') {
                return false;
            }
        }

        return true;
    }
}

HashedObject.registerClass(FeatureSet.className, FeatureSet);

export { FeatureSet };