import { CausalHistoryFragment } from 'data/history/CausalHistoryFragment';
import { OpCausalHistoryLiteral } from 'data/history/OpCausalHistory';
import { Hash, HashedObject, MutationOp } from 'data/model';
import { AgentPod } from 'mesh/service/AgentPod';
import { Store } from 'storage/store';
import { Logger, LogLevel } from 'util/logging';
import { Endpoint } from '../network/NetworkAgent';
import { PeerGroupAgent } from '../peer/PeerGroupAgent';
import { PeeringAgentBase } from '../peer/PeeringAgentBase';
import { AgentStateUpdateEvent, GossipEventTypes } from './StateGossipAgent';
import { StateSyncAgent } from './StateSyncAgent';
import { TerminalOpsState } from './TerminalOpsState';


enum MessageType {
    RequestHistory = 'request-history',
    SendHistory = 'send-history'
};

type RequestHistoryMsg = {
    type: MessageType.RequestHistory,
    target: Hash,
    terminalOps: Hash[],
    initialOps: Hash[],
    limit: Number
};

type SendHistoryMsg = {
    type: MessageType.SendHistory,
    target: Hash,
    history: OpCausalHistoryLiteral[]
}


type HistoryMsg = RequestHistoryMsg | SendHistoryMsg;

class CausalHistorySyncAgent extends PeeringAgentBase implements StateSyncAgent {

    static controlLog = new Logger(CausalHistorySyncAgent.name, LogLevel.INFO);

    target: Hash;
    acceptedMutationOpClasses: string[];

    store: Store;

    pod?: AgentPod;

    state?: TerminalOpsState;
    stateHash?: Hash;

    missing: Map<Endpoint, CausalHistoryFragment>;
    fetching: CausalHistoryFragment;

    controlLog: Logger;

    constructor(peerGroupAgent: PeerGroupAgent, target: Hash, store: Store, acceptedMutationOpClasses : string[]) {
        super(peerGroupAgent);

        this.target = target;
        this.acceptedMutationOpClasses = acceptedMutationOpClasses;
        this.store = store;

        this.missing = new Map();
        this.fetching = new CausalHistoryFragment(this.target);



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
        this.store.watchReferences('target', this.target, this.opCallback);
    }

    unwatchStoreForOps() {
        this.store.removeReferencesWatch('target', this.target, this.opCallback);
    }

    async opCallback(opHash: Hash): Promise<void> {

        this.controlLog.trace('Op ' + opHash + ' found for object ' + this.target + ' in peer ' + this.peerGroupAgent.getLocalPeer().endpoint);

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

    private async loadStateFromStore(): Promise<TerminalOpsState> {
        let terminalOpsInfo = await this.store.loadTerminalOpsForMutable(this.target);

        if (terminalOpsInfo === undefined) {
            terminalOpsInfo = {terminalOps: []};
        }

        return TerminalOpsState.create(this.target, terminalOpsInfo.terminalOps);
    }

    private updateState(state: TerminalOpsState): void {
        const stateHash = state.hash();

        if (this.stateHash === undefined || this.stateHash !== stateHash) {
            CausalHistorySyncAgent.controlLog.debug('Found new state ' + stateHash + ' for ' + this.target + ' in ' + this.peerGroupAgent.getLocalPeer().endpoint);
            this.state = state;
            this.stateHash = stateHash;
            let stateUpdate: AgentStateUpdateEvent = {
                type: GossipEventTypes.AgentStateUpdate,
                content: { agentId: this.getAgentId(), state }
            }
            this.pod?.broadcastEvent(stateUpdate);
        }

    }

    private shouldAcceptMutationOp(op: MutationOp): boolean {

        return this.target === op.target?.hash() &&
               this.acceptedMutationOpClasses.indexOf(op.getClassName()) >= 0;
    }

}

export { HistoryMsg, CausalHistorySyncAgent }