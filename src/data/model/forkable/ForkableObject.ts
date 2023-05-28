import { MultiMap } from 'util/multimap';
import { Hash } from '../hashing';
import { MutableObject, MutableObjectConfig, MutationEvent, MutationOp } from '../mutable';


import { LinearOp } from './LinearOp';
import { MergeOp } from './MergeOp';
import { ForkableOp } from './ForkableOp';
import { ForkChoiceRule } from './ForkChoiceRule';
import { Queue } from 'util/queue';
import { HashedObject } from '../immutable';

/*
 * TODO BEFORE PRIME TIME:
 * 
 *           - Add observer to LinearObject to apply this.linearizationRule when there's cascading of a
 *             dependency's linearization.
 *           - Add config option to sync so all the ops in the local store are applied to the target object.
 *           - When validating ops during sync, alias the target object so the one where all
 *             the ops have been applied is used.
 *           - Add config option to sync so only outgoing ops, incoming ops, or both are considered (that'd be:
 *             only push data to peers, only pull data from peers, full sync). This would be used for light clients
 *             to be able to create ops in the logbook.
 * 
 * 
 */ 



/* LinearObject: Base class for types that need to periodically "linearize" their history, choosing a unique sequence
 *               of steps among many possible such linearizations. They use an op (deriving from) LinearizationOp to
 *               model this linear steps. These linear types may depend on other linear types, and this is expressed by
 *               using the linearCausalOps field in LinearizationOp. This should be interpreted as: op can be in the 
 *               current linearization iif all the ops in op.linearCausalOps are in the current linearizations of their
 *               respective objects.
 * 
 *               When a new LinearizationOp is applied, it can optionally contain (non-linear) history in the form of
 *               other ops. This is modelling by using op.prevOps to point to the terminal ops in this bit of history, 
 *               which should converge to op.prevLinearOp:
 * 
 *               prevLinearOp points to                prevOps forms a DAG containing
 *               the previous linearization            other ops, which eventually converge
 *               step.                                 to the previous linar step.
 * 
 *                                    linearOp2
 *                                         |      \
 *                                         |      |\  prevOps
 *                                         |      | \
 *                            prevLinearOp |   op_A op_B  
 *                                         |      |  / 
 *                                         |      | /  prevOps
 *                                         v      |/
 *                                    linearOp1
 * 
 * 
 *               When implementing mutate(), a linear type can use the function isLinearlyValid(op) to inquire about
 *               whether all the linear dependencies of an op are currently satisfied. If this changes later, the
 *               function onEligibilityChange() will be called. Override if you need to react accordingly.
 * 
 *               Finally, to set the current linearization, call setCurrentLastLinearOp(op). 
 */

type ForkableObjectConfig<L extends LinearOp=LinearOp, M extends MergeOp=MergeOp, R=ForkChoiceRule<L, M>> = {
    forkChoiceRule?: R
}

enum ForkEvents {
    ForkChange  = 'fork-change'
}

type ForkChangeInfo = {
    removedFromFork: Set<Hash>;
    addedToFork: Set<Hash>;
}

const ForkEventActions: Array<string>  = [ForkEvents.ForkChange];

abstract class ForkableObject<L extends LinearOp=LinearOp, M extends MergeOp|never=MergeOp|never, R extends ForkChoiceRule<L, M>|undefined=ForkChoiceRule<L, M>|undefined> extends MutableObject {

    // All linear ops, indexed by their hashes (they will form a tree -wait no- a forest actually):
    _allForkableOps: Map<Hash, L|M>;

    // The inverse of the op.prevLinearOp relationship:
    // (the next possible op hashes starting form a given op hash)
    _nextForkableOps: MultiMap<Hash, Hash>;

    // All valid linear ops (their fork dependencies are satisfied):
    _allEligibleOps: Set<Hash>;
    _terminalEligibleOps: Set<Hash>;


    // Hashes for all the ops in the current linear chain:
    _allCurrentForkOps: Set<Hash>;
    // If the current head is undefined, the object is not linearized as all.
    _currentForkTerminalOp?: L|M;

    // The keys are all the invalid linear ops, with the hashes of the foreign ops they depend on that are currently
    // not valid (not in the linearization) as values:
    _unmetForkableOpDeps: MultiMap<Hash, Hash>;

    // Conversely, all the linear ops that are not valid and are dependencies of linear ops as keys, with the
    // invalidated ops as values:
    _reverseUnmetForkableOpDeps: MultiMap<Hash, Hash>;


    _unmetForkablePrevOps: MultiMap<Hash, Hash>;
    _reverseUnmetForkablePrevOps: MultiMap<Hash, Hash>;

    _allReverseForkableOpDeps: MultiMap<Hash, Hash>;

    _forkableDepTargets: Map<Hash, ForkableObject>;


    // in case a fork-choice rule is provided:
    _forkChoiceRule?: R;
    _orderedChoices: Array<L|M>;

    constructor(acceptedOpClasses : Array<string>, config?: MutableObjectConfig & ForkableObjectConfig<L, M, R>) {
        super(acceptedOpClasses, config);

        this._allForkableOps = new Map();
        this._allEligibleOps = new Set();

        this._terminalEligibleOps = new Set();

        this._nextForkableOps = new MultiMap();

        this._allCurrentForkOps = new Set();

        this._unmetForkableOpDeps = new MultiMap();
        this._reverseUnmetForkableOpDeps = new MultiMap();

        this._unmetForkablePrevOps = new MultiMap();
        this._reverseUnmetForkablePrevOps = new MultiMap(); 

        this._allReverseForkableOpDeps = new MultiMap();

        this._forkableDepTargets = new Map();

        this._forkChoiceRule = config?.forkChoiceRule;
        this._orderedChoices = new Array<L|M>();
        
        const forkableOpEligibilityMonitor = (ev: MutationEvent) => {

            if (ForkableObject.isForkRelatedEvent(ev) && !ev.emitter.equalsUsingLastHash(this)) {
                if (ev.action === ForkEvents.ForkChange) {

                    const forkInfo = ev.data as ForkChangeInfo;

                    const toCheckForAddition = new Set<Hash>();
                    
                    for (const depOpHash of forkInfo.addedToFork) {

                        for (const opHash of Array.from(this._reverseUnmetForkableOpDeps.get(depOpHash))) {
                            this._unmetForkableOpDeps.delete(opHash, depOpHash);
                            this._reverseUnmetForkableOpDeps.delete(depOpHash, opHash);
    
                            toCheckForAddition.add(opHash);
                        }
                    }

                    const addedEligibleOps = new Set<Hash>();

                    this.cascadeEligibleOpAdditions(toCheckForAddition, addedEligibleOps);

                    const toRemove = new Set<Hash>();

                    for (const depOpHash of forkInfo.removedFromFork) {

                        for (const opHash of Array.from(this._allReverseForkableOpDeps.get(depOpHash))) {
                        
                            if (this.isForkEligible(opHash)) {
                                toRemove.add(opHash);
                            }

                            this._unmetForkableOpDeps.add(opHash, depOpHash);
                            this._reverseUnmetForkableOpDeps.add(depOpHash, opHash);
                        }
                    }

                    const removedEligibleOps = new Set<Hash>();

                    this.cascadeEligibleOpRemovals(toRemove, removedEligibleOps);

                    const addedTerminalEligibleOps = new Set<Hash>();
                    const removedTerminalEligibleOps = new Set<Hash>();

                    this.updateEligibleTerminalOps(addedEligibleOps, removedEligibleOps, addedTerminalEligibleOps, removedTerminalEligibleOps);

                    this.applyForkChoiceRule(addedTerminalEligibleOps, removedTerminalEligibleOps);

                    this.onForkEligibilityChange(addedEligibleOps, removedEligibleOps, addedTerminalEligibleOps, removedTerminalEligibleOps);
                }
            }
        };

        this.addObserver(forkableOpEligibilityMonitor);
    }

    private cascadeEligibleOpAdditions(toCheckForAddition: Set<Hash>, addedEligibleOps: Set<Hash>) {

        while (toCheckForAddition.size > 0) {
            
            const opHash = toCheckForAddition.values().next().value as Hash;
            toCheckForAddition.delete(opHash);

            if (this.isForkEligible(opHash)) {

                for (const nextOpHash of this._nextForkableOps.get(opHash)) {

                    this._unmetForkablePrevOps.delete(nextOpHash, opHash);
                    this._reverseUnmetForkablePrevOps.delete(opHash, nextOpHash);

                    toCheckForAddition.add(nextOpHash);toCheckForAddition.add(nextOpHash);
                }

                this._allEligibleOps.add(opHash);
                addedEligibleOps.add(opHash);
            }
        }
    }

    private cascadeEligibleOpRemovals(toRemove: Set<Hash>, removedEligibleOps: Set<Hash>) {
        while (toRemove.size > 0) {
            const opHash = toRemove.values().next().value as Hash;
            toRemove.delete(opHash);

            this._allEligibleOps.delete(opHash);
            removedEligibleOps.add(opHash);

            for (const  nextOpHash of this._nextForkableOps.get(opHash)) {

                if (this.isForkEligible(nextOpHash)) {
                    toRemove.add(nextOpHash);
                }

                this._unmetForkablePrevOps.add(nextOpHash, opHash);
                this._reverseUnmetForkablePrevOps.add(opHash, nextOpHash);
            }
        }
    }

    private updateEligibleTerminalOps(addedEligibleOps: Set<Hash>, removedEligibleOps: Set<Hash>, addedTerminalEligibleOps: Set<Hash>, removedTerminalEligibleOps: Set<Hash>) {

        for (const opHash of addedEligibleOps.values()) {
            if (this.isForkEligibleTerminalOp(opHash)) {
                addedTerminalEligibleOps.add(opHash);
            }

            const op = this._allForkableOps.get(opHash) as L|M;

            for (const prevOpHash of op.getPrevForkOpHashes()) { // (*) see note below
                if (this._terminalEligibleOps.has(prevOpHash)) {
                    removedTerminalEligibleOps.add(prevOpHash);
                }
            }
        }

        for (const opHash of removedEligibleOps.values()) {
            const op = this._allForkableOps.get(opHash) as L|M;

            for (const prevOpHash of op.getPrevForkOpHashes()) {
                if (this.isForkEligibleTerminalOp(prevOpHash)) {
                    addedTerminalEligibleOps.add(opHash); // It must be new (added), since op was fork eligible and thus
                                                          // prevented it from being terminal before. 
                }
            }
        }


        // Note: this loop is unnecessary, since only the members of this._terminalEligibleOps for whom
        //       a successor has been added need to be checked, and this is done by check (*) above.

        /*for (const opHash of this._terminalEligibleOps.values()) {
            if (!this.isForkEligibleTerminalOp(opHash)) {
                removedTerminalEligibleOps.add(opHash);
            }
        }*/

        for (const opHash of addedTerminalEligibleOps.values()) {
            this._terminalEligibleOps.add(opHash);
        }

        for (const opHash of removedTerminalEligibleOps.values()) {
            this._terminalEligibleOps.delete(opHash);
        }
    }

    isForkEligible(opHash: Hash) {
        const result = !this._unmetForkableOpDeps.hasKey(opHash) && !this._unmetForkablePrevOps.hasKey(opHash) && this.isValidOp(opHash);

        /*console.log(opHash + ' isForkEligible: ' + result);

        if (!result) {
            if (this._unmetForkableOpDeps.hasKey(opHash)) {
                console.log('DEPS');
            }

            if (this._unmetForkablePrevOps.hasKey(opHash)) {
                console.log('PREV');
            }

            if (!this.isValidOp(opHash)) {
                console.log('VALID');
            }
        }*/

        return result;
    }

    isForkEligibleTerminalOp(opHash: Hash) {
        
        if (!this.isForkEligible(opHash)) {
            return false;
        }

        for (const nextOpHash of this._nextForkableOps.get(opHash).values()) {
            if (this.isForkEligible(nextOpHash)) {
                return false;
            }
        }

        return true;
    }

    // override to be notified whenever an op's fork dependencies become satisfied / unsatisifed.
    onForkEligibilityChange(_addedEligibleOps: Set<Hash>, _removedEligibleOps: Set<Hash>, _addedTerminalEligibleOps: Set<Hash>, _removedTerminalEligibleOps: Set<Hash>) {

    }

    isInCurrentFork(linearOpHash: Hash): boolean {
        return this._allCurrentForkOps.has(linearOpHash);
    }

    // override to be notified whenever the current linearization changes.
    onCurrentForkChange(_addedToCurrentFork: Set<Hash>, _removedFromCurrentFork: Set<Hash>) {

    }

    // We want the ops that we need to add to the current fork so it will end 
    // in newForkTerminalOpHash, and also find the "forking" ops that connect
    // this added segment to the current fork.

    // We will do a breadth-first scan until we find these "forking" ops, saving
    // all the visited ops in newForkOpsQueue. This queue may have duplicates,
    // whenever an op can be reached in more than one way.

    // Notice that the last appearence of an op in the queue comes after _all_
    // the ops that mention it in their prevForkableOps. This follows from the fact
    // that ops in the queue are in BFS-order. If such an op existed, then by following
    // prevForkableOps we could get to the op at again at a greater depth, and that
    // would mean that the op should appear again later in the queue, contradicting
    // our assumption about it being the last one.

    // So by reversing the queue and adding the _first_ appearnece of each op, we'll
    // get the ops in a causality-respecting order.

    toAddToCurrentFork(newForkTerminalOpHash: Hash) {

        const newForkOpsQueue = new Array<Hash>();
        const forking         = new Set<Hash>();

        const toCheck = new Queue<Hash>();

        toCheck.enqueue(newForkTerminalOpHash);

        while (toCheck.size() > 0) {

            const opHash = toCheck.dequeue();

            if (!this._allCurrentForkOps.has(opHash)) {
                const op = this._allForkableOps.get(opHash) as L|M;

                newForkOpsQueue.push(op.getLastHash());
                for (const prevForkOpHash of op.getPrevForkOpHashes()) {
                    toCheck.enqueue(prevForkOpHash);
                }
            } else {
                forking.add(opHash);
            }
        }

        const newForkOps = new Set<Hash>();

        for (const opHash of newForkOpsQueue.reverse()) {
            if (!newForkOps.has(opHash)) {
                newForkOps.add(opHash);
            }
        }

        return { newForkOps: newForkOps, forking: forking };
    }

    toRemoveFromCurrentFork(newForking?: Set<Hash>) {

        let toCheck     = new Queue<Hash>();
        let opsToRemove = new Set<Hash>();

        if (this._currentForkTerminalOp !== undefined) {
            toCheck.enqueue(this._currentForkTerminalOp.getLastHash());
        }

        while (toCheck.size() > 0) {

            const toCheckOpHash = toCheck.dequeue();

            if (newForking === undefined || !newForking.has(toCheckOpHash)) {
                
                // If some of the ops remaining in the current fork merge back into toCheckOpHash,
                // we can't remove it (at least yet - we may visit it again through other path).
                
                // Incidentally, this check also ensures that ops are added to opsToRemove in
                // reverse causal order, so the set can be iterated over to undo all the removed
                // ops, and no causality violations will ensue. 

                let foundRemainingNextOps = false;

                for (const nextOpHash of this._nextForkableOps.get(toCheckOpHash)) {
                    if (this._allCurrentForkOps.has(nextOpHash) && !opsToRemove.has(nextOpHash)) {
                        foundRemainingNextOps = true;
                        break;
                    }
                }

                if (!foundRemainingNextOps) {
                    opsToRemove.add(toCheckOpHash);

                    const toCheckOp = this._allForkableOps.get(toCheckOpHash) as L|M;

                    for (const prevForkOpHash of toCheckOp.getPrevForkOpHashes()) {
                        toCheck.enqueue(prevForkOpHash);
                    }
                }
            }
        }

        return opsToRemove;
        /*
        while (last?.getLastHash() !== opHash) {
            
            let unlinearizedOp = last;

            const prevHash = last?.prevForkableOp?.hash;

            if (prevHash === undefined) {
                last = undefined;
            } else {
                last = this._allForkableOps.get(prevHash);
            }

            this._currentForkTerminalOp = last;

            if (unlinearizedOp !== undefined) {
                this._allCurrentForkOps.delete(unlinearizedOp.getLastHash());
                this.onCurrentForkChange(unlinearizedOp.getLastHash(), false);
                this.getMutationEventSource().emit({emitter: this, action: ForkEvents.RetractLinearly, data: unlinearizedOp});
            }
        }
        */
    }

    // opHash, if present, must be eligible
    setCurrentForkTerminalOpTo(opHash?: Hash) {

        if (opHash !== this._currentForkTerminalOp?.getLastHash()) {

            const op = opHash !== undefined?
                            this._allForkableOps.get(opHash)
                        :
                        undefined;

            const backtrack = opHash !== undefined?
                                this.toAddToCurrentFork(opHash)
                            :
                                {newForkOps: new Set<Hash>(), forking: new Set<Hash>()};
            
            const toRemove = this.toRemoveFromCurrentFork(backtrack.forking);

            for (const opHash of toRemove.values()) {
                this._allCurrentForkOps.delete(opHash);
            }
    
            for (const opHash of backtrack.newForkOps.values()) {
                this._allCurrentForkOps.add(opHash);
            }
    
            this._currentForkTerminalOp = op;
            this.onCurrentForkChange(backtrack.newForkOps, toRemove);
            this.getMutationEventSource().emit({emitter: this, action: ForkEvents.ForkChange, data: {addedToFork: backtrack.newForkOps, removedFromFork: toRemove} as ForkChangeInfo})    
        
        }
        
        /*
        if (this._allCurrentForkOps.has(opHash)) {
            confluenceHash = op?.prevForkableOp?.hash;
        } else {

            toLinearize = this.toAddToCurrentFork(opHash).reverse();

            if (toLinearize.length > 0) {
                confluenceHash = toLinearize[toLinearize.length - 1]?.prevForkableOp?.hash;
            } else {
                confluenceHash = undefined;
            }
        }

        this.unforkToOp(confluenceHash)

        for (const linearizedOp of toLinearize) {
            this._allCurrentForkOps.add(linearizedOp.getLastHash());
            this._currentForkTerminalOp = linearizedOp;
            this.onCurrentForkChange(linearizedOp.getLastHash(), true);
            this.getMutationEventSource().emit({emitter: this, action: ForkEvents.AppendLinearly, data: linearizedOp});
        }*/
    }

    protected apply(op: MutationOp, isNew: boolean) : Promise<boolean> {

        const opHash = op.getLastHash();

        if (op instanceof ForkableOp && !this._allForkableOps.has(opHash)) {

            this._allForkableOps.set(opHash, op as L);

            let isEligible = true;

            for (const prevForkableOpHash of op.getPrevForkOpHashes()) {
                this._nextForkableOps.add(prevForkableOpHash as Hash, opHash); 
                
                if (!this.isForkEligible(prevForkableOpHash)) {
                    this._unmetForkablePrevOps.add(opHash, prevForkableOpHash);
                    this._reverseUnmetForkablePrevOps.add(prevForkableOpHash, opHash);

                    isEligible = false;
                }
            }

            if (op.forkCausalOps !== undefined) {

                for (const forkOpDep of op.forkCausalOps.values()) {
                    
                    this._allReverseForkableOpDeps.add(forkOpDep.getLastHash(), op.getLastHash());

                    const depTarget = forkOpDep.getTargetObject();
                    const depTargetSubobj = this.getLinearDepTargetSubobj(depTarget);

                    if (!depTargetSubobj.isInCurrentFork(forkOpDep.getLastHash())) {
                        this._unmetForkableOpDeps.add(op.getLastHash(), forkOpDep.getLastHash());
                        this._reverseUnmetForkableOpDeps.add(forkOpDep.getLastHash(), op.getLastHash());
                        isEligible = false;
                    }

                }
            }

            if (isEligible) {
                this._allEligibleOps.add(opHash);
            }
        }

        return super.apply(op, isNew);
    }

    async mutate(op: MutationOp, valid: boolean): Promise<boolean> {

        if (op instanceof ForkableOp) {

            const addedEligibleOps   = new Set<Hash>();
            const removedEligibleOps = new Set<Hash>();

            if (valid) {
                const toCheckForAddition = new Set<Hash>([op.getLastHash()].values());
                this.cascadeEligibleOpAdditions(toCheckForAddition, addedEligibleOps);
            } else {
                const toRemove = new Set<Hash>([op.getLastHash()].values());
                this.cascadeEligibleOpRemovals(toRemove, removedEligibleOps);
            }

            if (addedEligibleOps.size > 0 || removedEligibleOps.size > 0) {

                const addedTerminalEligibleOps   = new Set<Hash>();
                const removedTerminalEligibleOps = new Set<Hash>();

                this.updateEligibleTerminalOps(addedEligibleOps, removedEligibleOps, addedTerminalEligibleOps, removedTerminalEligibleOps);
            
                if (this._forkChoiceRule !== undefined) {
                    this.applyForkChoiceRule(addedTerminalEligibleOps, removedTerminalEligibleOps);
                }
                
                this.onForkEligibilityChange(addedEligibleOps, removedEligibleOps, addedTerminalEligibleOps, removedTerminalEligibleOps);

                return true;
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    getForkableOp(opHash: Hash, references?: Map<Hash, HashedObject>): ForkableOp {

        let op = references?.get(opHash) as ForkableOp|undefined;

        if (op === undefined) {
            op = this._allForkableOps.get(opHash);
        }

        if (op === undefined) {
            throw new Error('Could not get forkable op with hash ' + opHash + ': it was not applied to loaded instance of ' + this.getLastHash());
        }

        return op;
    }

    private applyForkChoiceRule(chiocesToAdd: Set<Hash>, choicesToRemove: Set<Hash>) {

        if (this._forkChoiceRule === undefined) {
            throw new Error('Trying to apply fork choice rule, but none was found for ' + this.getLastHash() + ' (of class ' + this.getClassName + ').');
        }

        if (choicesToRemove.size > 0) {

            const remainingChoices: Array<L|M> = [];

            for (const op of this._orderedChoices.values()) {
                if (!choicesToRemove.has(op.getLastHash())) {
                    remainingChoices.push(op);
                }
            }

            this._orderedChoices = remainingChoices;
        }

        
        if (chiocesToAdd.size > 0) {

            for (const hash of chiocesToAdd.values()) {
                const newop = this._allForkableOps.get(hash) as L|M;

                let i=0;

                while (i<this._orderedChoices.length && !this._forkChoiceRule.shouldReplaceCurrent(this._orderedChoices[i], newop)) {
                    i = i + 1;
                }

                this._orderedChoices.splice(i, 0, newop);
            }
        }

        if (this._orderedChoices.length > 0) {
            if (!this._orderedChoices[0].equals(this._currentForkTerminalOp)) {
                this.setCurrentForkTerminalOpTo(this._orderedChoices[0].getLastHash());
            }
        } else {
            if (this._currentForkTerminalOp !== undefined) {
                this.setCurrentForkTerminalOpTo(undefined);
            }
        }

    }

    private getLinearDepTargetSubobj(depTarget: ForkableObject): ForkableObject<any, any, any> {

        const depTargetHash = depTarget.getLastHash();

        if (depTargetHash === this.getLastHash()) {
            return this;
        }

        let depTargetSubobj = this._forkableDepTargets.get(depTargetHash);

        if (depTargetSubobj === undefined) {
            depTargetSubobj = this.getDirectSubObjects().get(depTargetHash) as (ForkableObject|undefined);

            if (depTargetSubobj !== undefined) {
                this._forkableDepTargets.set(depTargetHash, depTargetSubobj);
            }
        }

        if (depTargetSubobj !== undefined) {
            depTarget = depTargetSubobj;
        }

        return depTarget;
    }

    static isForkRelatedEvent(ev: MutationEvent) {
        return ForkEventActions.indexOf(ev.action) >= 0;
    }

    getTerminalEligibleOps() {
        const ops = new Set<L|M>();

        for (const opHash of this._terminalEligibleOps.values()) {
            ops.add(this._allForkableOps.get(opHash) as (L|M));
        }

        return ops;
    }
}

export { ForkableObject, ForkableObjectConfig };