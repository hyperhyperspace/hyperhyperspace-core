import { LinearizationOp } from 'data/model/linearizable/LinearizationOp';
import { LinearObject } from 'data/model/linearizable/LinearObject';
import { Hash, HashedObject, HashedSet, HashReference, MutationOp } from '../model';

class TransitionOp<T extends LinearObject> extends MutationOp {

    static className = 'hhs/v0/TransitionOp';

    constructor() {
        super();
    }

    maxLogEntryNumber?: bigint;

    transitionTarget?: T;
    transitionEndOp?: LinearizationOp; 
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

    getClassName(): string {
        return TransitionOp.className;
    }

    init(): void {
        
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        
        if (!(await super.validate(references))) {
            return false;
        }

        if (!(this.transitionTarget instanceof LinearObject)) {
            return false;
        }

        // Check the end op

        if (!(this.transitionEndOp instanceof LinearizationOp)) {
            HashedObject.validationLog.warning('The transitionEndOp in TransitionOp ' + this.getLastHash() + ' is not  an instance of LinearizationOp');
            return false;
        }

        if (!this.transitionEndOp.getTargetObject().equals(this.transitionTarget)) {
            HashedObject.validationLog.warning('The transitionEndOp in a TransitionOp' + this.getLastHash() + ' does not have the transitionTarget as its target.');
            return false;
        }


        // Retrieve and check start op

        const transitionStartOpHash = this.transitionEndOp.prevLinearOp?.hash;

        if (transitionStartOpHash !== undefined) {

            if (this.prevTransitionOp === undefined) {
                return false;
            } else {
                const prev = references.get(this.prevTransitionOp.hash) as TransitionOp<T>;

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
                if (prev.transitionEndOp?.getLastHash() !== transitionStartOpHash) {
                    return false;
                }

                if (typeof(this.prevTransitionLogEntryHash) !== 'string') {
                    return false;
                }

            }
            
        } else {
            if (this.prevTransitionLogEntryHash !== undefined ||
                this.prevTransitionOp !== undefined) {

                    return false;
            }
        }

        if (typeof(this.maxLogEntryNumber) !== 'bigint' || this.maxLogEntryNumber < BigInt(0)) {
            return false;
        }

        // Check the transition ops

        // We need to see that the transition really ends in the linearization end op,
        // that all the ops in the transition point to the transitionTarget, and that
        // the start op, if present, is reachable.

        if (!(this.transitionOps instanceof HashedSet)) {
            return false;
        }

        const all = new Map<Hash, MutationOp>();
        for (const op of this.transitionOps.values()) {
            if (!(op instanceof MutationOp)) {
                return false;
            }

            if (!op.getTargetObject().equals(this.transitionTarget)) {
                return false;
            }

            if (op instanceof LinearizationOp) {
                return false;
            }

            all.set(op.getLastHash(), op);
        }

        const reachable = new HashedSet<MutationOp>();
        const toVisit   = new Set<Hash>;

        for (const opRef of this.transitionEndOp.getPrevOps()) {
            if (opRef.hash !== transitionStartOpHash) { // The end op also has the start op in prevOps
                toVisit.add(opRef.hash);                // (if the end op is not the 1st linearization),
            }                                           // ignore it here.
        }

        let reachedStartState = false; // incidentally this implies that an "empty" transition (just start & end ops) will be invalid

        while (toVisit.size > 0) {
            const nextHashToVisit = toVisit.values().next().value as Hash;

            toVisit.delete(nextHashToVisit);
            
            if (nextHashToVisit === transitionStartOpHash) {
                reachedStartState = true;
            } else {
                const op = all.get(nextHashToVisit);

                if (op === undefined) {
                    return false;
                }

                if (!reachable.hasByHash(op.getLastHash())) {
                    reachable.add(op);

                    for (const opRef of op.getPrevOps()) {
                        if (!reachable.hasByHash(opRef.hash)) {
                            toVisit.add(opRef.hash);    
                        }
                    }
                }
            }
        }

        if (!reachable.equals(this.transitionOps)) {
            return false;
        }
        
        if (transitionStartOpHash !== undefined && !reachedStartState) {
            return false;
        }

        // Other stuff

        

        if (this.prevTransitionOp === undefined) {
            if (this.prevOps !== undefined && this.prevOps.size() > 0) {
                return false;
            }
        } else {
            if (this.prevOps === undefined || this.prevOps.size() !== 1) {
                return false;
            }
            if (!(this.prevOps.has(this.prevTransitionOp))) {
                return false;
            }
        }

        return true;

    }

    getTransitionStartOpHash(): Hash|undefined {
        return this.transitionEndOp?.prevLinearOp?.hash;
    }
}

export { TransitionOp };