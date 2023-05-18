import { MultiMap } from 'util/multimap';
import { ForkableObject, ForkableOp } from '../model';
import { Hash, HashedObject, HashedSet, HashReference, MutationOp } from '../model';

class TransitionOp<T extends ForkableObject> extends MutationOp {

    static className = 'hhs/v0/TransitionOp';

    maxLogEntryNumber?: bigint;

    transitionTarget?: T;
    transitionStartOp?: ForkableOp;
    transitionEndOp?: ForkableOp;
    transitionOps?: HashedSet<MutationOp>

    // The following left undefined for the fist state transition:

    prevTransitionOp?: HashReference<TransitionOp<T>>;
    prevTransitionLogEntryHash?: Hash;  // -> we use the hash instead of a proper HashReference  
                                        //    so users of the TransitionLog can create TransitionOps
                                        //    even without having synchronized the full log (this 
                                        //    object).

    // TODO: it'd make sense to filter TransitionOps in outgoing gossip if the maxLogEntryNumber or
    //       prevTransitionLogEntryHash don't make sense.
    //       (Can't do it in validation because the prevTransitionLogEntry may not have arrived at 
    //       the peer yet).

    constructor(maxLogEntryNumber?: bigint, 
                transitionTarget?: T, 
                transitionStartOp?: ForkableOp, 
                transitionEndOp?: ForkableOp, 
                transitionOps?: IterableIterator<MutationOp>,
                prevTransitionOp?: HashReference<TransitionOp<T>>,
                prevTransitionLogEntryHash?: Hash) 
        {
            super();

            this.maxLogEntryNumber = maxLogEntryNumber;
            this.transitionTarget  = transitionTarget;
            this.transitionStartOp = transitionStartOp;
            this.transitionEndOp   = transitionEndOp;
            this.transitionOps     = new HashedSet(transitionOps);
            this.prevTransitionOp  = prevTransitionOp;

            this.prevTransitionLogEntryHash = prevTransitionLogEntryHash;


            this.setPrevOps([].values());
    }

    getClassName(): string {
        return TransitionOp.className;
    }

    init(): void {
        
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        
        if (!(await super.validate(references))) {
            return false;
        }

        if (!(this.transitionTarget instanceof ForkableObject)) {
            return false;
        }

        // Check the end op

        if (!(this.transitionEndOp instanceof ForkableOp)) {
            HashedObject.validationLog.warning('The transitionEndOp in TransitionOp ' + this.getLastHash() + ' is not  an instance of ForkableOp');
            return false;
        }

        if (!this.transitionEndOp.getTargetObject().equals(this.transitionTarget)) {
            HashedObject.validationLog.warning('The transitionEndOp in a TransitionOp' + this.getLastHash() + ' does not have the transitionTarget as its target.');
            return false;
        }

        // Check the transitionStartOp & prevTransitionOp if they are present

        if (this.transitionStartOp !== undefined) {
            if (!(this.transitionStartOp instanceof ForkableOp)) {
                HashedObject.validationLog.warning('The transitionStartOp in TransitionOp ' + this.getLastHash() + ' is not an instance of ForkableOp');
                return false;
            }

            if (!this.transitionStartOp.getTargetObject().equals(this.transitionTarget)) {
                HashedObject.validationLog.warning('The transitionStartOp in a TransitionOp' + this.getLastHash() + ' does not have the transitionTarget as its target.');
                return false;
            }

            if (!(this.prevTransitionOp instanceof HashReference)) {
                HashedObject.validationLog.warning('The prevTransitionOp in TransitionOp ' + this.getLastHash() + ' is not a HashReference as it should.');
                return false;
            } else {
                const prev = references.get(this.prevTransitionOp.hash);

                if (!(prev instanceof TransitionOp)) {
                    return false;
                }

                // prev is in the same transition log
                if (!prev.getTargetObject().equalsUsingLastHash(this.getTargetObject())) {
                    return false;
                }

                if (!this.transitionTarget.equalsUsingLastHash(prev.transitionTarget)) {
                    return false;
                }

                // prev's ending state (op) matches this transition's starting state (op)
                if (prev.transitionEndOp?.equalsUsingLastHash(this.transitionStartOp)) {
                    return false;
                }

                if (typeof(this.prevTransitionLogEntryHash) !== 'string') {
                    return false;
                }
            }
        } else {
            if (this.prevTransitionOp !== undefined) {
                HashedObject.validationLog.warning('The transitionStartOp in TransitionOp ' + this.getLastHash() + ' is undefined, but there is a prevTransitionOp. In this case, the transitionStartOp should be present and match the end op of the previous transition.');
                return false;
            }

            if (this.prevTransitionLogEntryHash !== undefined) {
                HashedObject.validationLog.warning('The transitionStartOp in TransitionOp ' + this.getLastHash() + ' is undefined, but there is a prevTransitionLogEntryHash.');
                return false;
            }
        }

        if (typeof(this.maxLogEntryNumber) !== 'bigint' || this.maxLogEntryNumber < BigInt(0)) {
            return false;
        }

        // Check the transition ops

        // We will check that:

        // 1. Backtracking from the end op all the way back to the start op, we get exactly this.transitionOps
        // 2. All the ForkableOps present in this.transitionOps converge to the start op

        // This way, we may have ad-hoc mutation ops that are then referenced by the forkable ops, but we ensure
        // that when looking only the forkable ones, we get a self-contained state transition from start op to
        // end op.

        // (Checking 2. is only necessary if there _is_ a start op)

        if (!(this.transitionOps instanceof HashedSet)) {
            return false;
        }

        const all     = new Map<Hash, MutationOp>();
        const forward = new MultiMap<Hash, Hash>();

        const allForkable = new HashedSet<ForkableOp>();

        for (const op of this.transitionOps.values()) {
            if (!(op instanceof MutationOp)) {
                return false;
            }

            if (!op.getTargetObject().equals(this.transitionTarget)) {
                return false;
            }

            all.set(op.getLastHash(), op);

            if (this.transitionStartOp !== undefined) {
                if (op instanceof ForkableOp) {
                    allForkable.add(op);
                }
    
                const prevOps = op.getPrevOpsIfPresent();
    
                if (prevOps !== undefined) {
                    for (const prevOpRef of op.getPrevOps()) {
                        forward.add(prevOpRef.hash, op.getLastHash());
                    }
                }
    
            }            
        }



        const reachable = new HashedSet<MutationOp>();
        const toVisit   = new Set<Hash>;

        toVisit.add(this.transitionEndOp.getLastHash());

        while (toVisit.size > 0) {
            const nextHashToVisit = toVisit.values().next().value as Hash;

            toVisit.delete(nextHashToVisit);
            
            const op = all.get(nextHashToVisit);

            if (op === undefined) {
                return false;
            }

            if (!reachable.hasByHash(op.getLastHash())) {
                reachable.add(op);

                if (!op.equalsUsingLastHash(this.transitionStartOp)) {
                    if (nextHashToVisit !== this.transitionStartOp?.getLastHash()) {
                        for (const opRef of op.getPrevOps()) {
    
                            
                            if (!reachable.hasByHash(opRef.hash)) {
                                toVisit.add(opRef.hash);    
                            }
                        }
                    }            
                }
            }
        }

        if (!reachable.equals(this.transitionOps)) {
            HashedObject.validationLog.warning('TransitionOp ' + this.getLastHash() + ' contents closure does not match this.transitionOps.');
            return false;
        }

        if (this.transitionStartOp !== undefined) {

            if (!this.transitionOps.has(this.transitionStartOp)) {
                // This is already covered by the loop below but I want to give a clearer error message.
                HashedObject.validationLog.warning('TransitionOp ' + this.getLastHash() + ' does not include its startOp in this.transitionOps.');
                return false;
            }

            const reachableFork = new HashedSet<ForkableOp>();
            const toBacktrack   = new Set<Hash>();
            const backtracked   = new Set<Hash>();
    
            toBacktrack.add(this.transitionStartOp.getLastHash());

            while (toBacktrack.size > 0) {
                const nextHashToVisit = toBacktrack.values().next().value as Hash;
                toBacktrack.delete(nextHashToVisit);
                backtracked.add(nextHashToVisit);

                const op = all.get(nextHashToVisit);

                if (op === undefined) {
                    HashedObject.validationLog.warning('TransitionOp ' + this.getLastHash() + ' references op ' + nextHashToVisit + ', but it is missing from this.transitionOps.');
                    return false;
                }

                if (op instanceof ForkableOp) {
                    reachableFork.add(op);
                }

                for (const forwardOpHash of forward.get(nextHashToVisit)) {
                    if (!backtracked.has(forwardOpHash)) {
                        toBacktrack.add(forwardOpHash);
                    }
                }
            }

            if (!reachableFork.equals(allForkable)) {
                HashedObject.validationLog.warning('TransitionOp ' + this.getLastHash() + ' contents do not converge back to the start op.');
                return false;
            }
    
        }

        if ((this.prevOps as HashedSet<HashReference<MutationOp>>).size() > 0) {
            HashedObject.validationLog.warning('TransitionOp ' + this.getLastHash() + ' prevOps should be empty, but it is not (the ordering comes from the LogEntryOps in this case).');
            return false;
        }

        return true;

    }
}

export { TransitionOp };