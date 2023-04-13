import { LinearObject } from 'data/model/linearizable/LinearObject';
import { MultiMap } from 'util/multimap';
import { Hash, HashedObject, HashedSet, MutableObjectConfig } from '../model';

import { TransitionOp } from './TransitionOp';
import { LogEntryOp } from './LogEntryOp';

type TransitionLogConfig = {
    
}

type StateInfo = {
    stateHash: Hash,
    logEntryOpHash: Hash
}

abstract class TransitionLog<T extends LinearObject> extends LinearObject<LogEntryOp<T>> {

    static className = 'hhs/v0/TransitionLog';
    static opClasses = [TransitionOp.className, LogEntryOp.className];

    _currentLinearizedStates: Map<Hash, StateInfo>; // obj hash -> current StateInfo

    constructor(config: MutableObjectConfig & TransitionLogConfig = {}) {
        super(TransitionLog.opClasses, config);

        this._currentLinearizedStates = new Map();
    }

    /*async mutate(op: MutationOp, valid: boolean, cascade: boolean): Promise<boolean> {
        op; valid; cascade;
        
        if (op instanceof LogEntryOp) {

            

        }

        return true;
    }*/


    /* Adapt the contents of _currentLinearizedStates, so it always reflects the 
       current state of all the tracked objects (the last transition included in
       the current linearization). */

    onCurrentLinearizationChange(opHash: Hash, linearized: boolean) {

        const op = this._allLinearOps.get(opHash);

        if (op === undefined) {
            throw new Error('onCurrentLinearizationChange callback was invoked, but the received opHash is not present: ' + opHash);
        }

        if (op.transitionOps === undefined) {
            return;
        }

        for (const transitionOp of (op.transitionOps as HashedSet<TransitionOp<T>>).values()) {
                
            const newStateHash = transitionOp.transitionEndOp?.getLastHash() as Hash;
            const oldStateHash = transitionOp.transitionEndOp?.prevLinearOp?.hash;
            
            const transitionTargetHash = (transitionOp.transitionTarget as T).getLastHash();
            const currentStateHash = this._currentLinearizedStates.get(transitionTargetHash)?.stateHash;

            if (linearized) {
                
                if (oldStateHash !== currentStateHash) {
                    throw new Error ('Error adding op ' + opHash + ' to TransitionLog linearization: state mismatch.');
                }

                this._currentLinearizedStates.set(transitionTargetHash, {stateHash: newStateHash, logEntryOpHash: opHash});
            } else {
                if (newStateHash !== currentStateHash) {
                    throw new Error ('Error removing op ' + opHash + ' from TransitionLog linearization: state mismatch.');
                }

                if (oldStateHash === undefined) {
                    this._currentLinearizedStates.delete(transitionTargetHash);
                } else { 
                    this._currentLinearizedStates.set(transitionTargetHash, {stateHash: oldStateHash, logEntryOpHash: transitionOp.prevTransitionLogEntryHash as Hash});
                }
            }
        }
    }

    async getStateInfoAtEntry(transitionTargetHash: Hash, logEntryOp: LogEntryOp<T>): Promise<StateInfo|undefined> {

        let currentStateInfo: (StateInfo|undefined) = undefined;
        let currentLogEntryOp: (LogEntryOp<T>|undefined) = logEntryOp;

        // First look for the most recent state transition in logEntryOp and its predecessors, but stop if we
        // arrive at the current linearization 

        while (currentStateInfo === undefined && currentLogEntryOp !== undefined && !this._currentLinearOps.has(currentLogEntryOp.getLastHash())) {
            const transOp = currentLogEntryOp.getTransitionOpsByTransitionTarget().get(transitionTargetHash);
            
            if (transOp !== undefined) {

                // Found the latest state transition, we're done! Will exit loop in next iteration.
                currentStateInfo = {
                    stateHash: transOp.transitionEndOp?.getLastHash() as Hash,
                    logEntryOpHash: currentLogEntryOp?.getLastHash() as Hash
                };
            }
            
            // Walk back one log entry.

            const prevLinearOpHash = currentLogEntryOp.prevLinearOp?.hash;
            if (prevLinearOpHash === undefined) {
                currentLogEntryOp = undefined;
            } else {
                currentLogEntryOp = this._allLinearOps.get(prevLinearOpHash);
                if (currentLogEntryOp === undefined) {
                    currentLogEntryOp = (await this.loadOp(prevLinearOpHash)) as (LogEntryOp<T>|undefined);
                }
                if (currentLogEntryOp === undefined) {
                    throw new Error('Trying to load the current state info for transition target ' + transitionTargetHash + ' from the store, but it seems to be missing.')
                }
            }
        }

        if (currentStateInfo === undefined && currentLogEntryOp !== undefined) {
            // By the negation of the "while" guard above, we know then that currentLogEntryOp is in this._currentLinearOps
            // (in other words, we stopped the loop above on arrival to the current linearization)


            // Use the current state in the linearization,
            currentStateInfo = this._currentLinearizedStates.get(transitionTargetHash);

            // but we must check if this was changed after logEntryOp, and undo such changes.
            if (currentStateInfo !== undefined) {
                let backtrackCurrentLinearOp = this._currentLastLinearOp;

                // Undo the transitions walking back, starting from the current linearization last op, all the way
                // to the op where the logEntryOp branch converged with the current branch: 
                while (!backtrackCurrentLinearOp?.equalsUsingLastHash(currentLogEntryOp)) {

                    // Try to update the state, if there's a transition for transitionTargetHash
                    const transOp = currentLogEntryOp.getTransitionOpsByTransitionTarget().get(transitionTargetHash);
            
                    if (transOp !== undefined) {                        
                        if (transOp.prevTransitionLogEntryHash === undefined) {
                            currentStateInfo = undefined;
                            break;
                        } else {
                            currentStateInfo = {
                                stateHash: transOp.transitionEndOp?.prevLinearOp?.hash as Hash,
                                logEntryOpHash: transOp.prevTransitionLogEntryHash
                            };
                        }
                    }

                    // Walk back one log entry.

                    if (backtrackCurrentLinearOp?.prevLinearOp?.hash === undefined) {
                        backtrackCurrentLinearOp = undefined;
                    } else {
                        backtrackCurrentLinearOp = this._allLinearOps.get(backtrackCurrentLinearOp?.prevLinearOp.hash);
                    }
                }
            }
        }

        return currentStateInfo;
    }

    getMutableContents(): MultiMap<string, HashedObject> {
        throw new Error('Method not implemented.');
    }

    getMutableContentByHash(hash: string): Set<HashedObject> {
        hash;
        throw new Error('Method not implemented.');
    }

    getClassName(): string {
        throw new Error('Method not implemented.');
    }

    init(): void {
        throw new Error('Method not implemented.');
    }

    validate(references: Map<string, HashedObject>): Promise<boolean> {
        references;
        throw new Error('Method not implemented.');
    }

}

export { TransitionLog };