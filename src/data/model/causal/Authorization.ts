import { HashedSet } from '../immutable/HashedSet';
import { MutationOp } from '../mutable/MutationOp';


/**
 * Attestator: a function that takes an op and attempts to add the necesary entries
 *             to op.causalOps to attest that some condition is true at the time
 *             op was created (and in case any of those conditions are concurrently
 *             invalidated, the invalidation will be cascaded to op automatically
 *             by the store). If the function returns false, op.causalOps must remain 
 *             unchanged.
 * 
 * Verifier: a function that takes an op and checks that the necessary entries
 *           have been added to op.causalOps to attest that some condition was
 *           true at the time op was created. If also takes as parameter a set,
 *           and in case the verification is successful, it will add the keys
 *           of the op.causalOps map that were used. This allows the process
 *           performing the verification to record all the keys that are used,
 *           and later check that there are no superflous entries in op.causalOps.
 * 
 * Authorizer: an attestator / verifier pair, that is able to create the attestation
 *             entries in causalOps, and also verify that they are correctly created.
 * 
 *  (The attestator part will be used by whomever is creating the op, and the vefrification
 *   will be performed by other parties receiving the op during sync.)
 * 
 * The Authorization class has several combinator functions for Authorizers:
 * 
 * Authorization.always : always authorize
 * Authorization.never  : never authorize
 * Authorization.chain(a1, a2?) : authorizer iif a1 and (a2 === undefined || a2)
 * Authorization.all(authorizerss:[])   : authorize iif all of authorizers do
 * Authorization.oneOf(authorizerss:[]) : authorize iif one of authorizers do (and it will 
 *                                                                             use the first
 *                                                                             that does)
 * 
 * Verification.checkKeys(usedKeys, op): as mentioned above, will check if op.causalOps has
 *                                       _exactly_ the provided keys.
 */

type Attestator = (op: MutationOp) => Promise<boolean>;

class Attestation {
    static always : Attestator = (_op: MutationOp) => Promise.resolve(true);
    static never  : Attestator = (_op: MutationOp) => Promise.resolve(false);
    static chain  : (a1: Attestator, a2?: Attestator) => Attestator 

                  = (a1: Attestator, a2?: Attestator) => 
                            ( async (op: MutationOp) => {

                                    const savedCausalOps = op.getCausalOps().entries();

                                    if (await a1(op) && (a2 === undefined || await a2(op)))  {
                                        return true;
                                    } else {
                                        op.setCausalOps(savedCausalOps)
                                        return false;
                                    }
                                }
                            );


    static oneOf : (candidates: Array<Attestator>) => Attestator

                    = (candidates: Array<Attestator|undefined>) => (
                                        async (op: MutationOp) => {
                                            for (const candidate of candidates) {
                                                if (candidate !== undefined && await candidate(op)) {
                                                    return true;
                                                }
                                            }
                                            return false;
                                        });

    static all : (authorizers: Array<Attestator>) => Attestator

               = (authorizers: Array<Attestator>) =>
                                        async (op: MutationOp) => {

                                            const savedCausalOps = op.getCausalOps().entries();

                                            for (const authorize of authorizers) {
                                                if (!(await authorize(op))) {
                                                    op.setCausalOps(savedCausalOps);
                                                    return false;
                                                }
                                            }

                                            return true;
                                        }
}


type Verifier   = (op: MutationOp, usedKeys: Set<string>) => boolean;

class Verification {

    static always : Verifier = (_op: MutationOp, _usedKeys: Set<string>) => true;
    static never  : Verifier = (_op: MutationOp, _usedKeys: Set<string>) => false;

    static chain  : (v1: Verifier, v2?: Verifier) => Verifier

                  = (v1: Verifier, v2?: Verifier) => 
                        (op: MutationOp, usedKeys: Set<string>) => {

                            const newlyUsedKeys = new Set<string>();
                            if (v1(op, newlyUsedKeys) && (v2 === undefined || v2(op, newlyUsedKeys))) {
                                newlyUsedKeys.forEach((k: string) => usedKeys.add(k));
                                return true;
                            } else {
                                return false;
                            }
                        };

    static oneOf : (verifiers: Array<Verifier>) => Verifier 
    
        = (verifiers: Array<Verifier>) =>
            (op: MutationOp, usedKeys: Set<string>) => {

                for (const verifier of verifiers) {
                    if ((verifier(op, usedKeys))) {
                        return true;
                    }
                }

                return false;
            };

    static all : (verifiers: Array<Verifier>) => Verifier 
    
        = (verifiers: Array<Verifier>) =>
            (op: MutationOp, usedKeys: Set<string>) => {

                const newlyUsedKeys = new Set<string>();

                for (const verifier of verifiers) {
                    if (!(verifier(op, newlyUsedKeys))) {
                        return false;
                    }
                }

                newlyUsedKeys.forEach((k: string) => usedKeys.add(k));
                
                return true;
            };

    static checkKeys : (usedKeys: Set<string>, op: MutationOp) => boolean 
        
        = (usedKeys: Set<string>, op: MutationOp) => 
                (usedKeys.size === 0 && !op.hasCausalOps()) ||
                (op.hasCausalOps() && (new HashedSet<string>(usedKeys.values())).equals(new HashedSet<string>(op.getCausalOps()?.content?.keys())));
        
}

type Authorizer = {
    attempt: Attestator;
    verify: Verifier;
}

const attestProj  = (b: Authorizer) => b.attempt;
const verifyProj = (b: Authorizer) => b.verify;

class Authorization {

    static always : Authorizer = {
        attempt : Attestation.always,
        verify      : Verification.always
    };

    static never : Authorizer = {
        attempt : Attestation.never,
        verify      : Verification.never
    };

    static chain    : (b1: Authorizer, b2?: Authorizer) => Authorizer

                    = (b1: Authorizer, b2?: Authorizer) => {
                        return {
                            attempt : Attestation.chain(b1.attempt, b2?.attempt),
                            verify      : Verification.chain(b1.verify, b2?.verify)
                        };
                    }

    static all      : (builders: Array<Authorizer>) => Authorizer

                    = (builders: Array<Authorizer>) => {
                        return {
                            attempt : Attestation.all(builders.map(attestProj)),
                            verify      : Verification.all(builders.map(verifyProj))
                        }
                    };

    static oneOf    : (builders: Array<Authorizer>) => Authorizer

                    = (builders: Array<Authorizer>) => {
                        return {
                            attempt : Attestation.oneOf(builders.map(attestProj)),
                            verify      : Verification.oneOf(builders.map(verifyProj))
                        }
                    };

                    


}

export { Attestator, Verifier, Attestation, Verification, Authorizer, Authorization };