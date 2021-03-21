import { CausalHistoryFragment } from 'data/history/CausalHistoryFragment';
import { OpCausalHistoryLiteral } from 'data/history/OpCausalHistory';
import { Hash, HashedObject, HashedSet, Literal, MutationOp } from 'data/model';
import { AgentPod } from 'mesh/service/AgentPod';
import { Store } from 'storage/store';
import { Logger, LogLevel } from 'util/logging';
import { Endpoint } from '../network/NetworkAgent';
import { PeerGroupAgent } from '../peer/PeerGroupAgent';
import { PeeringAgentBase } from '../peer/PeeringAgentBase';
import { CausalHistoryState } from './CausalHistoryState';
import { AgentStateUpdateEvent, GossipEventTypes } from './StateGossipAgent';
import { StateSyncAgent } from './StateSyncAgent';


enum MessageType {
    RequestHistory = 'request-history',
    RequestHistoryReply = 'request-history-reply',
    SendObject = 'send-object'
};

type RequestHistoryMsg = {
    type: MessageType.RequestHistory,

    requestId: string,
    
    mutableObj: Hash,
    
    targetOpHistories: Hash[],
    backtrackOpHistories: Hash[], 
    knownOpHistories: Hash[],
    
    omissionProofsSecret: string,
    
    maxHistory: number,
    maxObjs: number
};

type RequestHistoryReplyMsg = {
    type: MessageType.RequestHistoryReply,

    requestId: string,
    
    history: OpCausalHistoryLiteral[],

    opHistorySequence: Hash[],
    objCount: number,

    omittedObjs: Hash[],
    omissionProofs: string[]
};

type SendObjectMsg = {
    type: MessageType.SendObject,

    requestId: string,

    sequence: number,
    literal: Literal
}

type HistoryMsg = RequestHistoryMsg | RequestHistoryReplyMsg | SendObjectMsg;

class CausalHistorySyncAgent extends PeeringAgentBase implements StateSyncAgent {

    static controlLog = new Logger(CausalHistorySyncAgent.name, LogLevel.INFO);

    mutableObj: Hash;
    acceptedMutationOpClasses: string[];

    store: Store;

    pod?: AgentPod;

    state?: HashedSet<Hash>;
    stateHash?: Hash;
    
    remoteStates: Map<Endpoint, HashedSet<Hash>>;

    discovered: CausalHistoryFragment;
    

    controlLog: Logger;

    constructor(peerGroupAgent: PeerGroupAgent, mutableObj: Hash, store: Store, acceptedMutationOpClasses : string[]) {
        super(peerGroupAgent);

        this.mutableObj = mutableObj;
        this.acceptedMutationOpClasses = acceptedMutationOpClasses;
        this.store = store;

        this.remoteStates = new Map();

        this.discovered = new CausalHistoryFragment(this.mutableObj);


        this.opCallback.bind(this);

        this.controlLog = CausalHistorySyncAgent.controlLog;
    }


    async receiveRemoteState(_sender: string, _stateHash: string, _state: HashedObject): Promise<boolean> {

        return false;

        /*
        let isNew = false;

        if (state instanceof TerminalOpsState && state.objectHash === this.target) {

            if (state.terminalOps !== undefined) {

                const unknown = new Set<Hash>();

                for (const opHash of state.terminalOps.values()) {
                    if (!this.missing.contents.has(opHash) && (await this.store.loadLiteral(opHash)) === undefined) {
                        unknown.add(opHash);
                    }
                }

                isNew = unknown.size === 0;
            }

        }

        return isNew;*/
    }
    
    getAgentId(): string {
        throw new Error('Method not implemented.');
    }

    ready(pod: AgentPod): void {
        
        this.pod = pod;
        this.updateStateFromStore();
        this.watchStoreForOps();
    }

    shutdown(): void {
        throw new Error('Method not implemented.');
    }

    receivePeerMessage(_source: string, _sender: string, _recipient: string, _content: any): void {
        throw new Error('Method not implemented.');
    }


    // Monitoring local state for changes: 

    watchStoreForOps() {
        this.store.watchReferences('target', this.mutableObj, this.opCallback);
    }

    unwatchStoreForOps() {
        this.store.removeReferencesWatch('target', this.mutableObj, this.opCallback);
    }

    async opCallback(opHash: Hash): Promise<void> {

        this.controlLog.trace('Op ' + opHash + ' found for object ' + this.mutableObj + ' in peer ' + this.peerGroupAgent.getLocalPeer().endpoint);

        let op = await this.store.load(opHash) as MutationOp;
        if (this.shouldAcceptMutationOp(op)) {
            await this.updateStateFromStore();  
        }
    };

    // Loading local state:

    private async updateStateFromStore(): Promise<void> {
        
        const state = await this.loadStateFromStore();
        
        this.updateState(state);
    }

    private async loadStateFromStore(): Promise<CausalHistoryState> {
        let terminalOpsInfo = await this.store.loadTerminalOpsForMutable(this.mutableObj);

        if (terminalOpsInfo === undefined) {
            terminalOpsInfo = {terminalOps: []};
        }

        return CausalHistoryState.createFromTerminalOps(this.mutableObj, terminalOpsInfo.terminalOps, this.store);
    }

    private updateState(state: CausalHistoryState): void {
        const stateHash = state.hash();

        if (this.stateHash === undefined || this.stateHash !== stateHash) {
            CausalHistorySyncAgent.controlLog.debug('Found new state ' + stateHash + ' for ' + this.mutableObj + ' in ' + this.peerGroupAgent.getLocalPeer().endpoint);
            this.state = state.terminalOpHistories;
            this.stateHash = stateHash;
            let stateUpdate: AgentStateUpdateEvent = {
                type: GossipEventTypes.AgentStateUpdate,
                content: { agentId: this.getAgentId(), state }
            }
            this.pod?.broadcastEvent(stateUpdate);
        }

    }

    private shouldAcceptMutationOp(op: MutationOp): boolean {

        return this.mutableObj === op.target?.hash() &&
               this.acceptedMutationOpClasses.indexOf(op.getClassName()) >= 0;
    }


    private findSources(opHistoryHash: Hash): Set<Endpoint> {

        const sources = new Set<Endpoint>();

        const successors = new Set<Hash>();

        successors.add(opHistoryHash);

        while (successors.size > 0) {
            const hash = successors.values().next().value as Hash;
            successors.delete(hash);

            for (const [endpoint, state] of this.remoteStates.entries()) {
                if (state.has(hash)) {
                    sources.add(endpoint);
                }
            }

            for (const nextHash of this.discovered.nextOpHistories.get(hash)) {
                successors.add(nextHash);
            }
        }

        return sources;

    }

    private createPack(opHistoryHash: Hash, source: Endpoint, maxSize: number): Array<Hash> {

        const sourceState = this.remoteStates.get(source) as HashedSet<Hash>;

        const toProcess = new Array<Hash>();
        const seen = new Set<Hash>()
        const contents = new Array<Hash>();

        toProcess.push(opHistoryHash);
        seen.add(opHistoryHash)

        while (toProcess.length > 0 && contents.length <= maxSize) {
            const current = toProcess.shift() as Hash;
            contents.push(current);

            if (! sourceState?.has(current)) {
                for (const next of this.discovered.nextOpHistories.get(current)) {
                    if (!seen.has(next)) {
                        toProcess.push(next);
                        seen.add(next);
                    }
                }
            }
            

        }

        return contents;
    }

}

export { HistoryMsg, CausalHistorySyncAgent }