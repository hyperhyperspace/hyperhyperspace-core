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
    SyncRequest = 'sync-request',
    SyncReply = 'sync-reply',
    SendObject = 'send-object',
    CancelRequest = 'cancel-request'
};

type SyncRequestMsg = {
    type: MessageType.SyncRequest,

    requestId: string,
    
    mutableObj: Hash,
    
    expecting: 'history' | 'ops' | 'both';

    targetOpHistories?: Hash[],
    startOpHistories?: Hash[],

    requestedOps?: Hash[]
    
    omissionProofsSecret?: string,
    
    maxHistory?: number,
    maxLiterals?: number
};

type SyncReplyMsg = {
    type: MessageType.SyncReply,

    requestId: string,
    
    history?: OpCausalHistoryLiteral[],
    sendingOps?: Hash[],

    omittedObjs: Hash[],
    omissionProofs: string[],

    literalCount: number
};

type SendObjectMsg = {
    type: MessageType.SendObject,

    requestId: string,

    sequence: number,
    literal: Literal
}

type CancelRequestMsg = {
    type: MessageType.CancelRequest,

    requestId: string
}

type HistoryMsg = SyncRequestMsg | SyncReplyMsg | SendObjectMsg | CancelRequestMsg;

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

}

export { HistoryMsg, CausalHistorySyncAgent }