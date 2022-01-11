import { HashedSet, MutationOp } from 'data/model';

type Authorizer = (op: MutationOp) => Promise<boolean>;
type Verifier   = (op: MutationOp, usedKeys: Set<string>) => boolean;

class Authorization {
    static always : Authorizer = (_op: MutationOp) => Promise.resolve(true);
    static never  : Authorizer = (_op: MutationOp) => Promise.resolve(false);
    static chain  : (a1: Authorizer, a2?: Authorizer) => Authorizer 

                 = (a1: Authorizer, a2?: Authorizer) => 
                            ( async (op: MutationOp) => (await a1(op) && (a2 === undefined || await a2(op))) );


    static firstOne : (candidates: Array<Authorizer>) => Authorizer

                 = (candidates: Array<Authorizer|undefined>) => (
                                        async (op: MutationOp) => {
                                            for (const candidate of candidates) {
                                                if (candidate !== undefined && await candidate(op)) {
                                                    return true;
                                                }
                                            }
                                            return false;
                                        });
                         
    //static all = (as: Array<Authorizer>) => 
    //    ( async (op: MutationOp) => await Promise.all(as.map()) );
}

class Verification {
    static all : (verifiers: Array<Verifier>) => Verifier 
    
        = (verifiers: Array<Verifier>) =>
            (op: MutationOp, usedKeys: Set<string>) => {

                for (const verifier of verifiers) {
                    if (!(verifier(op, usedKeys))) {
                        return false;
                    }
                }

                return true;
            }

    static keys : (usedKeys: Set<string>, op: MutationOp) => boolean 
        
        = (usedKeys: Set<string>, op: MutationOp) => 
            new HashedSet<string>(usedKeys.values()).equals(new HashedSet<string>(op.getCausalOps()?.content?.keys()));
        
}

export { Authorizer, Verifier, Authorization, Verification };