import { RNGImpl } from 'crypto/random';
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
    SyncRequest   = 'sync-request',
    SyncReply     = 'sync-reply',
    SendLiteral   = 'send-literal',
    CancelRequest = 'cancel-request'
};

type RequestId = string;

type SyncRequestMsg = {
    type: MessageType.SyncRequest,

    requestId: RequestId,
    
    mutableObj: Hash,
    
    expecting: 'history' | 'ops' | 'any';

    targetOpHistories?: Hash[],
    knownOpHistories?: Hash[],

    requestedOps?: Hash[]
    
    omissionProofsSecret?: string,
    
    maxHistory?: number,
    maxLiterals?: number
};

type SyncReplyMsg = {
    type: MessageType.SyncReply,

    requestId: RequestId,
    
    history?: OpCausalHistoryLiteral[],
    sendingOps?: Hash[],

    omittedObjs: Hash[],
    omissionProofs: string[],

    literalCount: number
};

type SendLiteralMsg = {
    type: MessageType.SendLiteral,

    requestId: RequestId,

    sequence: number,
    literal: Literal
}

type CancelRequestMsg = {
    type: MessageType.CancelRequest,

    requestId: RequestId,
    reason: 'invalid-reply'|'invalid-literal'|'out-of-order-literal'
}

type SyncMsg = SyncRequestMsg | SyncReplyMsg | SendLiteralMsg | CancelRequestMsg;

type RequestInfo = {
    request: SyncRequestMsg,
    reply?: SyncReplyMsg,
    remote: Endpoint,
    timestamp: number,
    lastObjectTimestamp?: number
};

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
    
    sentRequests: Map<RequestId, RequestInfo>;
    
    activeReceivedRequests: Map<RequestId, RequestInfo>;
    queuedReceivedRequests: Map<Endpoint, RequestInfo>;
     

    controlLog: Logger;

    constructor(peerGroupAgent: PeerGroupAgent, mutableObj: Hash, store: Store, acceptedMutationOpClasses : string[]) {
        super(peerGroupAgent);

        this.mutableObj = mutableObj;
        this.acceptedMutationOpClasses = acceptedMutationOpClasses;
        this.store = store;

        this.remoteStates = new Map();

        this.discovered = new CausalHistoryFragment(this.mutableObj);


        this.sentRequests = new Map();
        
        this.activeReceivedRequests = new Map();
        this.queuedReceivedRequests = new Map();

        this.opCallback.bind(this);

        this.controlLog = CausalHistorySyncAgent.controlLog;
    }


    async receiveRemoteState(sender: string, stateHash: string, state: HashedObject): Promise<boolean> {
        
        let isNew = false;

        if (state instanceof CausalHistoryState && state.mutableObj === this.mutableObj) {

            if (state.terminalOpHistories !== undefined) {

                this.remoteStates.set(sender, new HashedSet<Hash>(state.terminalOpHistories?.values()))

                if (this.stateHash !== stateHash) {

                    const unknown = new Set<Hash>();

                    for (const opHistory of state.terminalOpHistories.values()) {
                        if (!this.discovered.contents.has(opHistory) && (await this.store.loadOpCausalHistoryByHash(opHistory)) === undefined) {
                            unknown.add(opHistory);
                        }
                    }

                    isNew = unknown.size > 0;

                    if (isNew) {
                        this.requestUnknownOpHistories(sender, unknown);
                    }

                }

            }

        }

        return isNew;
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

    receivePeerMessage(source: string, sender: string, recipient: string, content: any): void {
        
        const msg: SyncMsg = content as SyncMsg;

        if (msg.type === MessageType.SyncRequest) {

        } else if (msg.type === MessageType.SyncReply) {

        } else if (msg.type === MessageType.SendLiteral) {

        } else if (msg.type === MessageType.CancelRequest) {
            
        }

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

    // requesting history

    private requestUnknownOpHistories(destination: Endpoint, unknown: Set<Hash>) {

        const msg: SyncRequestMsg = {
            type: MessageType.SyncRequest,
            requestId: this.newRequestId(),
            mutableObj: this.mutableObj,
            expecting: 'any',
            targetOpHistories: Array.from(unknown.values()),
            // FIXME: if there's no local state yet, maybe the following is unwise?
            knownOpHistories: this.state === undefined? [] : Array.from(this.state.values()),
            omissionProofsSecret: new RNGImpl().randomHexString(128),
            maxHistory: 256,
            maxLiterals: 256
        };

        const reqInfo: RequestInfo = {
            request: msg,
            remote: destination,
            timestamp: Date.now()
        };

        this.sentRequests.set(msg.requestId, reqInfo);

        this.sendMessageToPeer(destination, this.getAgentId(), msg);
    }

    private newRequestId() {
        return new RNGImpl().randomHexString(128);
    }

}

export { SyncMsg as HistoryMsg, CausalHistorySyncAgent }