import { MultiMap } from 'util/multimap';
import { Hash } from '../hashing';
import { MutableObject, MutableObjectConfig, MutationEvent, MutationOp } from '../mutable';
import { LinearizationOp } from './LinearizationOp';

/* LinearObject: Base class for types that need to periodically "linearize" their history, choosing a unique sequence
 *               of steps amongst many possible such linearizations. They use an op (deriving from) LinearizationOp to
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
 *               function onLinearValidityChange() will be called. Override if you need to react accordingly.
 * 
 *               Finally, to set the current linearization, call setCurrentLastLinearOp(op). 
 */

enum LinearizationEvents {
    LinearizedOp = 'linearized-op',
    UnLinearizedOp = 'un-linearized-op'
}

const LinearizationEventActions: Array<string>  = [LinearizationEvents.LinearizedOp, LinearizationEvents.UnLinearizedOp];

abstract class LinearObject<L extends LinearizationOp=LinearizationOp> extends MutableObject {

    // All linear ops, indexed by their hashes (they will form a tree -wait no- a forest actually):
    _allLinearOps: Map<Hash, L>;

    // The inverse of the op.prevLinearOp relationship:
    // (the next possible op hashes starting form a given op hash)
    _nextLinearOps: MultiMap<Hash, Hash>;

    // All valid linear ops (their linear dependencies are satisfied):
    _allValidLinearOps: Set<Hash>;



    // Hashes for all the ops in the current linear chain:
    _currentLinearOps: Set<Hash>;
    // If the current head is undefined, the object is not linearized as all.
    _currentLastLinearOp?: L;

    // The keys are all the invalid linear ops, with the hashes of the foreign ops they depend on that are currently
    // not valid (not in the linearization) as values:
    _unmetLinearOpDeps: MultiMap<Hash, Hash>;

    // Conversely, all the linear ops that are not valid and are dependencies of linear ops as keys, with the
    // invalidated ops as values:
    _reverseUnmetLinearOpDeps: MultiMap<Hash, Hash>;


    _allReverseLinearOpDeps: MultiMap<Hash, Hash>;

    _linearDepTargets: Map<Hash, LinearObject>;

    constructor(acceptedOpClasses : Array<string>, config?: MutableObjectConfig) {
        super(acceptedOpClasses, config);

        this._allLinearOps = new Map();
        this._allValidLinearOps = new Set();

        this._nextLinearOps = new MultiMap();

        this._currentLinearOps = new Set();

        this._unmetLinearOpDeps = new MultiMap();
        this._reverseUnmetLinearOpDeps = new MultiMap();

        this._allReverseLinearOpDeps = new MultiMap();

        this._linearDepTargets = new Map();

        const linearValidityMonitor = (ev: MutationEvent) => {

            if (LinearObject.isLinearizationEvent(ev)) {
                if (ev.action === LinearizationEvents.LinearizedOp) {

                    const depOp = ev.data as LinearizationOp;
                    const depOpHash = depOp.getLastHash();

                    for (const opHash of Array.from(this._reverseUnmetLinearOpDeps.get(depOp.getLastHash()))) {
                        this._unmetLinearOpDeps.delete(opHash, depOpHash);
                        this._reverseUnmetLinearOpDeps.delete(depOpHash, opHash);

                        if (!this._unmetLinearOpDeps.hasKey(opHash)) {
                            this._allValidLinearOps.add(opHash);
                            this.onLinearValidityChange(opHash, true);
                        }
                    }

                    
                } else if (ev.action === LinearizationEvents.UnLinearizedOp) {

                    const depOp = ev.data as LinearizationOp;
                    const depOpHash = depOp.getLastHash();

                    for (const opHash of Array.from(this._allReverseLinearOpDeps.get(depOpHash))) {
                        
                        this._unmetLinearOpDeps.add(opHash, depOpHash);
                        this._reverseUnmetLinearOpDeps.add(depOpHash, opHash);

                        if(this._allValidLinearOps.has(opHash)) {
                            this._allValidLinearOps.delete(opHash);
                            this.onLinearValidityChange(opHash, false);
                        }
                    }
                }
            }
        };

        this.addObserver(linearValidityMonitor);
    }

    isLinearlyValid(opHash: Hash) {
        return this._allValidLinearOps.has(opHash);
    }

    // override to be notified whenever an op's linear validity changes.
    onLinearValidityChange(_opHash: Hash, _valid: boolean) {

    }

    isInCurrentLinearization(linearOpHash: Hash): boolean {
        return this._currentLinearOps.has(linearOpHash);
    }

    // override to be notified whenever the current linearization changes.
    onCurrentLinearizationChange(_opHash: Hash, _linearized: boolean) {

    }

    backtrackToCurrentLinearization(opHash: Hash) {

        const backtrack: Array<L> = [];

        while (!this._currentLinearOps.has(opHash)) {

            const op = this._allLinearOps.get(opHash);

            backtrack.push(op as L);


            if (op?.prevLinearOp === undefined) {
                break;
            } else {
                opHash = op.prevLinearOp.hash;
            }
        }

        return backtrack;
    }

    unlinearizeToOp(opHash?: Hash) {
        
        let last = this._currentLastLinearOp;

        while (last?.getLastHash() !== opHash) {
            
            let unlinearizedOp = last;

            const prevHash = last?.prevLinearOp?.hash;

            if (prevHash === undefined) {
                last = undefined;
            } else {
                last = this._allLinearOps.get(prevHash);
            }

            this._currentLastLinearOp = last;

            if (unlinearizedOp !== undefined) {
                this._currentLinearOps.delete(unlinearizedOp.getLastHash());
                this.onCurrentLinearizationChange(unlinearizedOp.getLastHash(), false);
                this.getMutationEventSource().emit({emitter: this, action: LinearizationEvents.UnLinearizedOp, data: unlinearizedOp});
            }
        }
    }

    // opHash is assumed to be in _allValidHeads
    setCurrentLastLinearOpTo(opHash: Hash) {

        const op = this._allLinearOps.get(opHash);

        let toLinearize: Array<L> = [];

        let confluenceHash: Hash|undefined;

        if (this._currentLinearOps.has(opHash)) {
            confluenceHash = op?.prevLinearOp?.hash;
        } else {

            toLinearize = this.backtrackToCurrentLinearization(opHash).reverse();

            if (toLinearize.length > 0) {
                confluenceHash = toLinearize[toLinearize.length - 1]?.prevLinearOp?.hash;
            } else {
                confluenceHash = undefined;
            }
        }

        this.unlinearizeToOp(confluenceHash)

        for (const linearizedOp of toLinearize) {
            this._currentLinearOps.add(linearizedOp.getLastHash());
            this._currentLastLinearOp = linearizedOp;
            this.onCurrentLinearizationChange(linearizedOp.getLastHash(), true);
            this.getMutationEventSource().emit({emitter: this, action: LinearizationEvents.LinearizedOp, data: linearizedOp});
        }
    }

    protected apply(op: MutationOp, isNew: boolean) : Promise<boolean> {
    
        const opHash = op.getLastHash();

        if (op instanceof LinearizationOp && !this._allLinearOps.has(opHash)) {

            this._allLinearOps.set(opHash, op as L);

            this._nextLinearOps.add(op.prevLinearOp?.hash as Hash, opHash);

            let isValid = true;

            if (op.linearCausalOps !== undefined) {

                for (const linearOpDep of op.linearCausalOps.values()) {
                    
                    this._allReverseLinearOpDeps.add(linearOpDep.getLastHash(), op.getLastHash());

                    const depTarget = linearOpDep.getTargetObject();
                    const depTargetSubobj = this.getLinearDepTargetSubobj(depTarget);

                    if (!depTargetSubobj.isInCurrentLinearization(linearOpDep.getLastHash())) {
                        this._unmetLinearOpDeps.add(op.getLastHash(), linearOpDep.getLastHash());
                        this._reverseUnmetLinearOpDeps.add(linearOpDep.getLastHash(), op.getLastHash());
                    } else {
                        isValid = false;
                    }

                }
            }

            if (isValid) {
                this._allValidLinearOps.add(opHash);
            }
        }

        return super.apply(op, isNew);
    }

    private getLinearDepTargetSubobj(depTarget: LinearObject): LinearObject {

        const depTargetHash = depTarget.getLastHash();

        if (depTargetHash === this.getLastHash()) {
            return this;
        }

        let depTargetSubobj = this._linearDepTargets.get(depTargetHash);

        if (depTargetSubobj === undefined) {
            depTargetSubobj = this.getDirectSubObjects().get(depTargetHash) as (LinearObject|undefined);

            if (depTargetSubobj !== undefined) {
                this._linearDepTargets.set(depTargetHash, depTargetSubobj);
            }
        }

        if (depTargetSubobj !== undefined) {
            depTarget = depTargetSubobj;
        }

        return depTarget;
    }

    static isLinearizationEvent(ev: MutationEvent) {
        return LinearizationEventActions.indexOf(ev.action) >= 0;
    }
}

export { LinearObject };