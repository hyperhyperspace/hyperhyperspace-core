import { MutationOp } from 'data/model';

type Authorizer = (op: MutationOp) => Promise<boolean>;

class Authorization {
    static always : Authorizer = (_op: MutationOp) => Promise.resolve(true);
    static never  : Authorizer = (_op: MutationOp) => Promise.resolve(false);
    static chain  = (a1: Authorizer, a2?: Authorizer) => 
        ( async (op: MutationOp) => (await a1(op) && (a2 === undefined || await a2(op))) );
    //static all = (as: Array<Authorizer>) => 
    //    ( async (op: MutationOp) => await Promise.all(as.map()) );
}

export { Authorizer, Authorization };