import { CausalSet } from 'data/containers';
import { Identity } from 'data/identity';
import { Hash, HashedObject, MutationOp } from 'data/model';
import { Authorizer, Authorization } from 'data/model';

type Feature = string;

class FeatureSet extends CausalSet<Feature> {

    static className = 'hhs-test/FeatureSet';

    authorized?: CausalSet<Identity>;
    features?: Array<Feature>;

    constructor(authorized?: CausalSet<Identity>, features?: Array<Feature>) {
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
            throw new Error('Cannot enable feature ' + feature + ', accepted features are: ' + this.features);
        }

        return this.disableByHash(HashedObject.hashElement(feature), author, extraAuthorizer);
    }

    async disableByHash(hash: Hash, author: Identity, extraAuthorizer?: Authorizer): Promise<boolean> {
        return super.deleteByHash(hash, author, this.createAuthorizerFor(author, extraAuthorizer));
    }

    protected createAuthorizerFor(author: Identity, extraAuthorizer?: Authorizer): Authorizer|undefined {

        const owner = this.authorized?.getAuthor();

        if (!author.equals(owner)) {
            return Authorization.chain(
                    (op:  MutationOp) => this.getAuthorizedIdentitiesSet().attestMembershipForOp(author, op),
                    extraAuthorizer
                );
        } else {
            return extraAuthorizer;
        }
    }

    getAuthorizedIdentitiesSet() {
        return this.authorized as CausalSet<Identity>;
    }

    shouldAcceptMutationOp(op: MutationOp, opReferences: Map<Hash, HashedObject>): boolean {

        opReferences;
        
        if (!this.isAcceptedMutationOpClass(op)) {
            console.log('A')
            return false;
        }

        const owner = this.getAuthor();

        if (owner !== undefined && !owner.equals(op.getAuthor())) {
            console.log('B')
            return false;
        }

        return true;
    }

}

HashedObject.registerClass(FeatureSet.className, FeatureSet);

export { FeatureSet };