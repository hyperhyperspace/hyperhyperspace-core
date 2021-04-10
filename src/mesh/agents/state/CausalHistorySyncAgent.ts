import { Hash, HashedObject, HashedSet, Literal, LiteralUtils, MutationOp } from 'data/model';
import { AgentPod } from 'mesh/service/AgentPod';
import { Store } from 'storage/store';
import { Logger, LogLevel } from 'util/logging';
import { Endpoint } from '../network/NetworkAgent';
import { PeerGroupAgent } from '../peer/PeerGroupAgent';
import { PeeringAgentBase } from '../peer/PeeringAgentBase';
import { CausalHistoryState } from './CausalHistoryState';
import { AgentStateUpdateEvent, GossipEventTypes } from './StateGossipAgent';
import { StateSyncAgent } from './StateSyncAgent';

import { CausalHistorySynchronizer } from './causal/CausalHistorySynchronizer';
import { CausalHistoryProvider, MessageType, SyncMsg } from './causal/CausalHistoryProvider';

class CausalHistorySyncAgent extends PeeringAgentBase implements StateSyncAgent {

    static controlLog = new Logger(CausalHistorySyncAgent.name, LogLevel.INFO);
    static messageLog = new Logger(CausalHistorySyncAgent.name, LogLevel.TRACE);

    static syncAgentIdFor(objHash: Hash, peerGroupId: string) {
        return 'causal-sync-for-' + objHash + '-in-peer-group-' + peerGroupId;
    }

    static MaxRequestsPerRemote = 2;

    mutableObj: Hash;
    acceptedMutationOpClasses: string[];

    store: Store;

    pod?: AgentPod;

    state?: HashedSet<Hash>;
    stateHash?: Hash;
    
    remoteStates: Map<Endpoint, HashedSet<Hash>>;

    synchronizer : CausalHistorySynchronizer;
    provider     : CausalHistoryProvider;


    controlLog: Logger;
    messageLog: Logger;

    constructor(peerGroupAgent: PeerGroupAgent, mutableObj: Hash, store: Store, acceptedMutationOpClasses : string[]) {
        super(peerGroupAgent);

        this.mutableObj = mutableObj;
        this.acceptedMutationOpClasses = acceptedMutationOpClasses;

        this.store = store;

        this.remoteStates = new Map();

        this.synchronizer = new CausalHistorySynchronizer(this);
        this.provider     = new CausalHistoryProvider(this);

        this.opCallback = this.opCallback.bind(this);

        this.controlLog = CausalHistorySyncAgent.controlLog;
        this.messageLog = CausalHistorySyncAgent.messageLog;
    }



    
    getAgentId(): string {
        return CausalHistorySyncAgent.syncAgentIdFor(this.mutableObj, this.peerGroupAgent.peerGroupId);
    }

    ready(pod: AgentPod): void {
        
        this.pod = pod;
        this.updateStateFromStore();
        this.watchStoreForOps();
    }

    shutdown(): void {
        
    }


    // Reactive logic:
    //                   - Gossip agent informing us of the reception of remote state updates
    //                   - Messages from peers with requests, replies, literals, etc.

    async receiveRemoteState(sender: string, stateHash: string, state: HashedObject): Promise<boolean> {
        let isNew = false;

        if (state instanceof CausalHistoryState && state.mutableObj === this.mutableObj) {

            if (state.terminalOpHistories !== undefined) {

                this.remoteStates.set(sender, new HashedSet<Hash>(state.terminalOpHistories?.values()))

                if (this.stateHash !== stateHash) {

                    const unknown = new Set<Hash>();

                    for (const opHistory of state.terminalOpHistories.values()) {
                        if ((await this.store.loadOpCausalHistoryByHash(opHistory)) === undefined) {
                            unknown.add(opHistory);
                        }
                    }

                    isNew = unknown.size > 0;

                    if (isNew) {
                        this.synchronizer.onNewHistory(sender, unknown);
                    }

                }

            }

        }

        return isNew;

    }

    receivePeerMessage(source: Endpoint, sender: Hash, recipient: Hash, content: any): void {

        sender; recipient;
        
        const msg: SyncMsg = content as SyncMsg;

        if (this.messageLog.level <= LogLevel.DEBUG) {
            this.messageLog.debug('Msg received from: ' + source + ' to: ' + this.peerGroupAgent.getLocalPeer().endpoint, msg);
        }

        if (msg.type === MessageType.Request) {
            this.provider.onReceivingRequest(source, msg);
        } else if (msg.type === MessageType.Response) {
            this.synchronizer.onReceivingResponse(source, msg);
        } else if (msg.type === MessageType.SendLiteral) {
            this.synchronizer.onReceivingLiteral(source, msg);
        } else if (msg.type === MessageType.RejectRequest) { 
            this.synchronizer.onReceivingRequestRejection(source, msg);
        } else if (msg.type === MessageType.CancelRequest) {
             this.provider.onReceivingRequestCancellation(source, msg);
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

    literalIsValidOp(literal?: Literal): boolean {
        
        let valid = false;

        if (this.acceptedMutationOpClasses !== undefined && literal !== undefined) {
            const fields    = LiteralUtils.getFields(literal);
            const className = LiteralUtils.getClassName(literal);

            if (fields['target'] !== undefined && fields['target']._hash === this.mutableObj &&
                this.acceptedMutationOpClasses.indexOf(className) >= 0) {

                valid = true;
            }
        }

        return valid;
    }

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
            CausalHistorySyncAgent.controlLog.trace('Found new state ' + stateHash + ' for ' + this.mutableObj + ' in ' + this.peerGroupAgent.getLocalPeer().endpoint);
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

export { SyncMsg as HistoryMsg, CausalHistorySyncAgent }