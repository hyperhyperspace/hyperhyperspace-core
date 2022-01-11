import { CausalSet, SingleAuthorCausalSet } from 'data/containers';
import { CausalSetAddOp, CausalSetDeleteOp} from 'data/containers/CausalSet';
import { Identity } from 'data/identity';
import { Authorization, Hash, HashedObject, MutationOp } from 'data/model';
import { Authorizer } from 'data/model';
import { Verification } from 'data/model/Authorization';

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

    async enable(feature: Feature, author: Identity, extraAuthorizer?: Authorizer): Promise<boolean> {

        if (this.features !== undefined && this.features.indexOf(feature) < 0) {
            throw new Error('Cannot enable feature ' + feature + ', accepted features are: ' + this.features);
        }

        return super.add(feature, author, this.createAuthorizerFor(author, extraAuthorizer));
    }

    async disable(feature: Feature, author: Identity, extraAuthorizer?: Authorizer): Promise<boolean> {

        if (this.features !== undefined && this.features.indexOf(feature) < 0) {
            throw new Error('Cannot disable feature ' + feature + ', accepted features are: ' + this.features);
        }

        return this.disableByHash(HashedObject.hashElement(feature), author, this.createAuthorizerFor(author, extraAuthorizer));
    }

    async disableByHash(hash: Hash, author: Identity, extraAuthorizer?: Authorizer): Promise<boolean> {

        return super.deleteByHash(hash, author, this.createAuthorizerFor(author, extraAuthorizer));
    }

    isEnabled(feature: Feature) {
        return this.has(feature);
    }

    isEnabledByHash(hash: Hash) {
        return this.hasByHash(hash);
    }

    protected createAuthorizerFor(author: Identity, extraAuthorizer?: Authorizer): Authorizer|undefined {

        const owner = this.authorized?.getAuthor();

        if (author.equals(owner)) {
            return Authorization.always;
        } else {
            return Authorization.chain(this.getAuthorizedIdentitiesSet().createMembershipAuthorizer(author), extraAuthorizer);
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

            if (owner === undefined || !owner.equals(op.getAuthor())) {
                if (!opAuthor.equals(this.getAuthorizedIdentitiesSet().getAuthor())) {

                    const usedKeys = new Set<string>();
                    const verify = this.getAuthorizedIdentitiesSet().createMembershipVerifier(opAuthor);

                    if (!(verify(op, usedKeys)) ) {
                        return false
                    }

                    if (!Verification.keys(usedKeys, op)) {
                        return false;
                    }
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