import { Hash, HashedObject, HashedSet, Literal, LiteralUtils, MutationOp } from 'data/model';
import { AgentPod } from 'mesh/service/AgentPod';
import { Store } from 'storage/store';
import { Logger, LogLevel } from 'util/logging';
import { Endpoint } from '../network/NetworkAgent';
import { PeerGroupAgent } from '../peer/PeerGroupAgent';
import { PeeringAgentBase } from '../peer/PeeringAgentBase';
import { HeaderBasedState } from './history/HeaderBasedState';
import { AgentStateUpdateEvent, GossipEventTypes } from './StateGossipAgent';
import { StateSyncAgent } from './StateSyncAgent';

import { HistorySynchronizer } from './history/HistorySynchronizer';
import { HistoryProvider, MessageType, SyncMsg } from './history/HistoryProvider';
import { OpHeader, OpHeaderLiteral } from 'data/history/OpHeader';
import { Resources } from 'spaces/Resources';

type StateFilter = (state: HeaderBasedState, store: Store) => Promise<HeaderBasedState>;

class HeaderBasedSyncAgent extends PeeringAgentBase implements StateSyncAgent {

    static controlLog = new Logger(HeaderBasedSyncAgent.name, LogLevel.INFO);
    static messageLog = new Logger(HeaderBasedSyncAgent.name, LogLevel.INFO);

    static syncAgentIdFor(objHash: Hash, peerGroupId: string) {
        return 'causal-sync-for-' + objHash + '-in-peer-group-' + peerGroupId;
    }

    static MaxRequestsPerRemote = 2;

    mutableObj: Hash;
    acceptedMutationOpClasses: string[];
    stateOpFilter?: StateFilter;

    resources: Resources;
    store: Store;

    pod?: AgentPod;

    state?: HashedSet<Hash>;
    stateHash?: Hash;
    
    remoteStates: Map<Endpoint, HashedSet<Hash>>;

    synchronizer : HistorySynchronizer;
    provider     : HistoryProvider;

    terminated = false;

    controlLog: Logger;
    messageLog: Logger;

    constructor(peerGroupAgent: PeerGroupAgent, mutableObj: Hash, resources: Resources, acceptedMutationOpClasses : string[], stateOpFilter?: StateFilter) {
        super(peerGroupAgent);

        this.mutableObj = mutableObj;
        this.acceptedMutationOpClasses = acceptedMutationOpClasses;
        this.stateOpFilter = stateOpFilter;

        this.resources = resources;
        this.store     = resources.store;

        this.remoteStates = new Map();

        this.synchronizer = new HistorySynchronizer(this);
        this.provider     = new HistoryProvider(this);

        this.opCallback = this.opCallback.bind(this);

        this.controlLog = HeaderBasedSyncAgent.controlLog;
        this.messageLog = HeaderBasedSyncAgent.messageLog;
    }



    
    getAgentId(): string {
        return HeaderBasedSyncAgent.syncAgentIdFor(this.mutableObj, this.peerGroupAgent.peerGroupId);
    }

    ready(pod: AgentPod): void {
        
        this.pod = pod;
        this.updateStateFromStore().then(async () => {
                if (this.state !== undefined) {
                    for (const hash of this.state.values()) {
                        const opHistory = await this.store.loadOpHeaderByHeaderHash(hash) as OpHeader;
                        const op = await this.store.load(opHistory?.opHash) as MutationOp;
                        await this.synchronizer.onNewLocalOp(op);
                    }
                }
            }
        );
        this.watchStoreForOps();
    }

    shutdown(): void {

        this.terminated = true;
        this.synchronizer.shutdown();
        
    }


    // Reactive logic:
    //                   - Gossip agent informing us of the reception of remote state updates
    //                   - Messages from peers with requests, replies, literals, etc.

    async receiveRemoteState(sender: string, stateHash: string, state: HashedObject): Promise<boolean> {
        
        if (this.terminated) return false;

        let isNew = false;

        if (state instanceof HeaderBasedState && state.mutableObj === this.mutableObj) {



            this.remoteStates.set(sender, new HashedSet<Hash>(state.terminalOpHeaderHashes?.values()))

            if (this.stateHash !== stateHash) {


                const filteredState = this.stateOpFilter === undefined? state : await this.stateOpFilter(state, this.store);

                const unknown = new Set<OpHeader>();

                for (const opHistoryLiteral of (filteredState.terminalOpHeaders as HashedSet<OpHeaderLiteral>).values()) {
                    if ((await this.store.loadOpHeaderByHeaderHash(opHistoryLiteral.headerHash)) === undefined) {
                        unknown.add(new OpHeader(opHistoryLiteral));
                    }
                }

                isNew = unknown.size > 0;

                if (isNew) {
                    this.synchronizer.onNewHistory(sender, unknown);
                }

            }

        }

        return isNew;

    }

    receivePeerMessage(source: Endpoint, sender: Hash, recipient: Hash, content: any): void {

        if (this.terminated) return;

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
        this.store.watchReferences('targetObject', this.mutableObj, this.opCallback);
    }

    unwatchStoreForOps() {
        this.store.removeReferencesWatch('targetObject', this.mutableObj, this.opCallback);
    }

    async opCallback(opHash: Hash): Promise<void> {

        if (this.terminated) return;

        this.controlLog.trace('Op ' + opHash + ' found for object ' + this.mutableObj + ' in peer ' + this.peerGroupAgent.getLocalPeer().endpoint);

        let op = await this.store.load(opHash) as MutationOp;
        if (this.shouldAcceptMutationOp(op)) {
            this.synchronizer.onNewLocalOp(op);
            await this.updateStateFromStore();  
        }
    };

    literalIsValidOp(literal?: Literal): boolean {
        
        let valid = false;

        if (this.acceptedMutationOpClasses !== undefined && literal !== undefined) {
            const fields    = LiteralUtils.getFields(literal);
            const className = LiteralUtils.getClassName(literal);

            if (fields['targetObject'] !== undefined && fields['targetObject']._hash === this.mutableObj &&
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

    private async loadStateFromStore(): Promise<HeaderBasedState> {
        let terminalOpsInfo = await this.store.loadTerminalOpsForMutable(this.mutableObj);

        if (terminalOpsInfo === undefined) {
            terminalOpsInfo = {terminalOps: []};
        }

        const state = await HeaderBasedState.createFromTerminalOps(this.mutableObj, terminalOpsInfo.terminalOps, this.store);

        if (this.stateOpFilter === undefined) {
            return state;
        } else {
            return this.stateOpFilter(state, this.store);
        }
    }

    private updateState(state: HeaderBasedState): void {
        const stateHash = state.hash();

        if (this.stateHash === undefined || this.stateHash !== stateHash) {
            HeaderBasedSyncAgent.controlLog.trace('Found new state ' + stateHash + ' for ' + this.mutableObj + ' in ' + this.peerGroupAgent.getLocalPeer().endpoint);
            this.state = state.terminalOpHeaderHashes;
            this.stateHash = stateHash;
            let stateUpdate: AgentStateUpdateEvent = {
                type: GossipEventTypes.AgentStateUpdate,
                content: { agentId: this.getAgentId(), state }
            }
            this.pod?.broadcastEvent(stateUpdate);
        }

    }

    private shouldAcceptMutationOp(op: MutationOp): boolean {

        return this.mutableObj === op.targetObject?.hash() &&
               this.acceptedMutationOpClasses.indexOf(op.getClassName()) >= 0;
    }

    async lastStoredOpsDescription(limit=25) {

        const load = await this.store.loadByReference('targetObject', this.mutableObj, { order: 'desc', limit: limit});

        const last = load.objects.length === limit? 'last ' : '';

        let contents = 'Showing ' + last + load.objects.length + ' ops in store for ' + this.mutableObj + '\n';

        let idx=0;
        for (const op of load.objects) {
            const opHistory = await this.store.loadOpHeader(op.getLastHash()) as OpHeader;
            contents = contents + idx + ': ' + opHistory.opHash + ' causal: ' + opHistory.headerHash + ' -> [' + Array.from(opHistory.prevOpHeaders) + ']\n';
            idx=idx+1;
        }

        return contents;            
    }

}

export { SyncMsg as HistoryMsg, HeaderBasedSyncAgent, StateFilter }