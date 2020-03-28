import { HashedObject } from './HashedObject';
import { MutationOp } from './MutationOp';

// concepts: - mutable object
//           - mutation operation
//           - operation closure
//           - state as a subset of terminal operations

// ????

//           - operation, chain, dag, swarm, agent, rules, 
//             state, terminal state, closure, observable,
//             agreement, consensus, crdt, tree, 


// X1 is a mutable
// X2 is a mutable
// X3 is a mutable

// Y is a mutable about { X1, X2, X3 }

/*

so you got just an op on Y, linking X1 to Y. ops to X1 will not point to Y, 
but Y's state could depend on the 'state' of X1.

in this fashion, an immutable object's state is constant.

we're at a dilemma here. it's like a mutable object seems to have two hashes associated:
a fixed hash used to identify it, and to find its operations
a mutable hash used to know its internal state

the first hash could be computationally determined by a shared or pre-established context
to ease discoverability

isinstance MutableObject sounds nice, to check if a HashedObject has internal state
sounds like a nice way to derive state

but is in conflict with the idea of state being determined by the terminal objects of the
operation set (maybe that's not very sound - or general enough)

nay the recursion state is wrong.

if X1 changes, Y has not received any changes. if sufficies to know that X1 remains in Y, 
so Y is unchanged. if the user needs to observe changes to X1, he should start following
those.

the thing is that following the set of terminal nodes seems too noisy for open world-objects.
anybody could add stuff to the operation chain and bloat things up. you seem to need 
selectivity to accept those ops into your state-defining terminal set.

the swarm-of-swarms concept is also vague. how would such a thing coordinate itself?

how do you distinguish intra-swarm state vs inter-swarm coordination state?

in the previous example, would the swarm following X1 leapfrog the swarm followng Y in
any way?

mutable 12a42vhsa2asa./ peers 12342 253234 13123 432434 state 1fff212322323./
mutable 0599af21a5222./ peers 12323 231233 23123 232122 state 82812adg212ff./


instead of terminal set, you use a terminal object (another hashed object) that has the 
(terminal) operations whose closure define the state and anything else necessary.

it could be nice if this terminal object could be an operation itself, maybe? again could add noise.



*/

abstract class MutableObject extends HashedObject {

    _unsavedOps : Array<MutationOp>;

    constructor() {
        super();
        
        this._unsavedOps = [];
    }

    abstract currentState(): HashedObject;
    
    abstract subscribeToCurrentState(callback: ((mutable: MutableObject, state: HashedObject) => void)): void;
    abstract unsubscribeFromCurrentState(callback: ((mutable: MutableObject, state: HashedObject) => void)): void;

    abstract validate(op: MutationOp): boolean;
    abstract mutate(op: MutationOp): void;

    apply(op: MutationOp) : void {

        if (!this.validate(op)) {
            throw new Error ('Invalid op ' + op.hash() + 'attempted for ' + this.hash());
        } else {
            this.mutate(op);
            this._unsavedOps.push(op);
        }
    }

    takeNextOpToSave() {
        if (this._unsavedOps.length > 0) {
            return this._unsavedOps.shift();
        } else {
            return undefined;
        }
    }

    returnNextOpToSave(op: MutationOp) {
        this._unsavedOps.unshift(op);
    }

}

export { MutableObject }