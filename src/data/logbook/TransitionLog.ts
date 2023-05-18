import { ForkChoiceRule, Hash, HashedObject, MutableObjectConfig } from '../model';
import { ForkableObject, ForkableObjectConfig } from '../model';
import { MultiMap } from 'util/multimap';

import { TransitionOp } from './TransitionOp';
import { LogEntryOp } from './LogEntryOp';

type StateInfo = {
    stateHash: Hash,
    logEntryOpHash: Hash
}

abstract class TransitionLog<T extends ForkableObject, I=undefined, R extends ForkChoiceRule<LogEntryOp<T,I>, never>|undefined=undefined> extends ForkableObject<LogEntryOp<T, I>, never, R> {

    static className = 'hhs/v0/TransitionLog';
    static opClasses = [TransitionOp.className, LogEntryOp.className];

    _currentForkStates: Map<Hash, StateInfo>; // obj hash -> current StateInfo

    constructor(config?: MutableObjectConfig & ForkableObjectConfig<LogEntryOp<T,I>, never, R> ) {
        super(TransitionLog.opClasses, config);

        this._currentForkStates = new Map();
    }


    onCurrentForkChange(addedToCurrentFork: Set<Hash>, removedFromCurrentFork: Set<Hash>) {

        for (const hash of removedFromCurrentFork) {
            const logEntryOp = this._allForkableOps.get(hash);

            if (logEntryOp !== undefined) {
                for (const transitionOp of logEntryOp.transitionOps?.values()!) {

                    // TODO: check that transitionOp reflects the current state in this._currentForkStates.

                    const targetHash = transitionOp.transitionTarget?.getLastHash() as Hash;

                    if (transitionOp.transitionStartOp === undefined) {
                        this._currentForkStates.delete(targetHash);
                    } else {

                        const restoredStateInfo = {
                            stateHash: transitionOp.transitionStartOp.getLastHash(), 
                            logEntryOpHash: transitionOp.prevTransitionLogEntryHash as Hash
                        };

                        this._currentForkStates.set(targetHash, restoredStateInfo);
                    }
                }
            }
        }

        for (const hash of addedToCurrentFork) {
            const logEntryOp = this._allForkableOps.get(hash);

            if (logEntryOp !== undefined) {
                for (const transitionOp of logEntryOp.transitionOps?.values()!) {

                    // TODO: check that the starting state in transitionOp matches the one in this._currentForkStates.

                    const targetHash = transitionOp.transitionTarget?.getLastHash() as Hash;

                    const newStateInfo = {
                        stateHash: transitionOp.transitionEndOp?.getLastHash() as Hash,
                        logEntryOpHash: transitionOp.prevTransitionLogEntryHash as Hash
                    }

                    this._currentForkStates.set(targetHash, newStateInfo);

                } 
            }
        }

    }

    // TODO: use an index / checkpoints

    async getStateInfoAtEntry(transitionTargetHash: Hash, logEntryOp: LogEntryOp<T, I>, references?: Map<Hash, HashedObject>): Promise<StateInfo|undefined> {

        let currentStateInfo: (StateInfo|undefined) = undefined;
        let currentLogEntryOp: (LogEntryOp<T, I>|undefined) = logEntryOp;

        // First look for the most recent state transition in logEntryOp and its predecessors, but stop if we
        // arrive at the current linearization 

        while (currentStateInfo === undefined && currentLogEntryOp !== undefined && !this._allCurrentForkOps.has(currentLogEntryOp.getLastHash())) {
            const transOp = currentLogEntryOp.getTransitionOpsByTarget().get(transitionTargetHash);
            
            if (transOp !== undefined) {

                // Found the latest state transition, we're done! Will exit loop in next iteration.
                currentStateInfo = {
                    stateHash: transOp.transitionEndOp?.getLastHash() as Hash,
                    logEntryOpHash: currentLogEntryOp?.getLastHash() as Hash
                };
            }
            
            // Walk back one log entry.

            const prevLinearOpHash = currentLogEntryOp.prevForkableOp?.hash;
            if (prevLinearOpHash === undefined) {
                currentLogEntryOp = undefined;
            } else {

                currentLogEntryOp = this._allForkableOps.get(prevLinearOpHash);

                if (currentLogEntryOp === undefined) {
                    currentLogEntryOp = references?.get(prevLinearOpHash) as (LogEntryOp<T, I>|undefined);
                }

                if (currentLogEntryOp === undefined) {
                    currentLogEntryOp = (await this.loadOp(prevLinearOpHash)) as (LogEntryOp<T, I>|undefined);
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
            currentStateInfo = this._currentForkStates.get(transitionTargetHash);

            // but we must check if this was changed after logEntryOp, and undo such changes.
            if (currentStateInfo !== undefined) {
                let backtrackCurrentLinearOp = this._currentForkTerminalOp;

                // Undo the transitions walking back, starting from the current linearization last op, all the way
                // to the op where the logEntryOp branch converged with the current branch: 
                while (!backtrackCurrentLinearOp?.equalsUsingLastHash(currentLogEntryOp)) {

                    // Try to update the state, if there's a transition for transitionTargetHash
                    const transOp = currentLogEntryOp.getTransitionOpsByTarget().get(transitionTargetHash);
            
                    if (transOp !== undefined) {                        
                        if (transOp.transitionStartOp === undefined) {
                            currentStateInfo = undefined;
                            break;
                        } else {
                            currentStateInfo = {
                                stateHash: transOp.transitionStartOp?.getLastHash() as Hash,
                                logEntryOpHash: transOp.prevTransitionLogEntryHash as Hash
                            };
                        }
                    }

                    // Walk back one log entry.

                    if (backtrackCurrentLinearOp?.prevForkableOp?.hash === undefined) {
                        backtrackCurrentLinearOp = undefined;
                    } else {
                        backtrackCurrentLinearOp = this._allForkableOps.get(backtrackCurrentLinearOp?.prevForkableOp.hash);
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