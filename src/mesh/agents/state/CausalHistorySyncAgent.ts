import { RNGImpl } from 'crypto/random';
import { CausalHistoryFragment } from 'data/history/CausalHistoryFragment';
import { OpCausalHistory, OpCausalHistoryLiteral } from 'data/history/OpCausalHistory';
import { Hash, HashedObject, HashedSet, Literal, LiteralContext, MutationOp } from 'data/model';
import { AgentPod } from 'mesh/service/AgentPod';
import { Store } from 'storage/store';
import { Logger, LogLevel } from 'util/logging';
import { MultiMap } from 'util/multimap';
import { Endpoint } from '../network/NetworkAgent';
import { PeerGroupAgent } from '../peer/PeerGroupAgent';
import { PeeringAgentBase } from '../peer/PeeringAgentBase';
import { CausalHistoryState } from './CausalHistoryState';
import { AgentStateUpdateEvent, GossipEventTypes } from './StateGossipAgent';
import { StateSyncAgent } from './StateSyncAgent';


enum MessageType {
    SyncRequest       = 'sync-request',
    SyncReply         = 'sync-reply',
    SyncReject        = 'sync-reject',
    SendLiteral       = 'send-literal',
    CancelSyncRequest = 'cancel-sync-request'
};

type RequestId = string;

type SyncRequestMsg = {
    type: MessageType.SyncRequest,

    requestId: RequestId,
    
    mutableObj: Hash,
    
    expecting: 'history' | 'ops' | 'any';

    requestedOpHistories?          : Hash[], // op histories we want to get
    terminalFetchedOpHistories? : Hash[],  // last op histories whose op was already fetched

    // If the target is too far from the point we have fetched so far, the other end will not
    // do the traversal for us. Hence we must fetch the history over several requests, and then
    // request the ops by their hashes using the following:
    requestedOps?: Hash[],
    
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

type SyncRejectMsg = {
    type: MessageType.SyncReject,

    requestId: RequestId,

    reason: 'too-busy'|'invalid-request'|'unknown-target'|'other',
    detail: string
}

type SendLiteralMsg = {
    type: MessageType.SendLiteral,

    requestId: RequestId,

    sequence: number,
    literal: Literal
}

type CancelSyncRequestMsg = {
    type: MessageType.CancelSyncRequest,

    requestId: RequestId,
    reason: 'invalid-reply'|'invalid-literal'|'out-of-order-literal'|'slow-connection'|'other',
    detail: string
}

type SyncMsg = SyncRequestMsg | SyncReplyMsg | SyncRejectMsg | SendLiteralMsg | CancelSyncRequestMsg;


type SyncRequestInfo = {

    request: SyncRequestMsg,
    reply?: SyncReplyMsg,
    remote: Endpoint,
    status: 'created'|'sent'|'queued',

    sentTimestamp?: number,
    replyTimestamp?: number,
    lastLiteralTimestamp?: number,
    lastLiteralSequence?: number,
    lastOpSequence?: number,

    receivedLiterals?: LiteralContext 
};

type SyncReplyInfo = {

    request: SyncRequestMsg,
    reply: SyncReplyMsg,
    remote: Endpoint,
    status: 'created'|'replied'|'queued',

    repliedTimestamp?: number,
    lastLiteralTimestamp?: number,

    sendingQueue: Array<Literal>

}

class CausalHistorySyncAgent extends PeeringAgentBase implements StateSyncAgent {

    static controlLog = new Logger(CausalHistorySyncAgent.name, LogLevel.INFO);

    static MaxRequestsPerRemote = 2;

    mutableObj: Hash;
    acceptedMutationOpClasses: string[];

    store: Store;

    pod?: AgentPod;

    state?: HashedSet<Hash>;
    stateHash?: Hash;
    
    remoteStates: Map<Endpoint, HashedSet<Hash>>;

    discoveredHistory: CausalHistoryFragment;
    //pendingFragment: CausalHistoryFragment;

    requests : Map<RequestId, SyncRequestInfo>;
    replies  : Map<RequestId, SyncReplyInfo>;   

    requestsForOpHistory : MultiMap<Hash, RequestId>;
    requestsForOp        : MultiMap<Hash, RequestId>;

    currentRequests: MultiMap<Endpoint, RequestId>;
    queuedRequests: Map<Endpoint, RequestId[]>;

    currentReplies: Map<Endpoint, RequestId>;
    queuedReplies: Map<Endpoint, RequestId[]>;


    controlLog: Logger;

    constructor(peerGroupAgent: PeerGroupAgent, mutableObj: Hash, store: Store, acceptedMutationOpClasses : string[]) {
        super(peerGroupAgent);

        this.mutableObj = mutableObj;
        this.acceptedMutationOpClasses = acceptedMutationOpClasses;
        this.store = store;

        this.remoteStates = new Map();

        this.discoveredHistory = new CausalHistoryFragment(this.mutableObj);
        //this.pendingFragment    = new CausalHistoryFragment(this.mutableObj);

        this.requests = new Map();
        this.replies  = new Map();

        this.requestsForOpHistory = new MultiMap();
        this.requestsForOp        = new MultiMap();

        this.currentRequests = new MultiMap();
        this.queuedRequests  = new Map();

        this.currentReplies  = new Map();
        this.queuedReplies   = new Map();


        this.opCallback.bind(this);

        this.controlLog = CausalHistorySyncAgent.controlLog;
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
                        if (!this.discoveredHistory.contents.has(opHistory) && (await this.store.loadOpCausalHistoryByHash(opHistory)) === undefined) {
                            unknown.add(opHistory);
                        }
                    }

                    isNew = unknown.size > 0;

                    if (isNew) {
                        this.onOpHistoryGossip(sender, unknown);
                    }

                }

            }

        }

        return isNew;
    }

    receivePeerMessage(source: Endpoint, sender: Hash, recipient: Hash, content: any): void {

        sender; recipient;
        
        const msg: SyncMsg = content as SyncMsg;

        if (msg.type === MessageType.SyncRequest) {

        } else if (msg.type === MessageType.SyncReply) {
            this.onReply(source, msg);
        } else if (msg.type === MessageType.SendLiteral) {

        } else if (msg.type === MessageType.CancelSyncRequest) {
             
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

    // Receiving end of sync

    // High-level: react to newly discovered history (opHistories found by gossip and replies to requests)
    
    // Upon discovering new opHistories, immediately ask for history + ops 
    // (if the ops follow after our current state)
    private onOpHistoryGossip(remote: Endpoint, newOpHistories: Set<Hash>) {
        this.requestHistory(remote, newOpHistories);
    }

    private onReply(remote: Endpoint, msg: SyncReplyMsg) {

        const reqInfo = this.requests.get(msg.requestId);

        // if request is known and was sent to 'remote' and unreplied as of now:
        if (reqInfo !== undefined && reqInfo.remote === remote && reqInfo.reply === undefined) {
            reqInfo.reply = msg;

            const req   = reqInfo.request;
            const reply = reqInfo.reply;

            let newHistory: CausalHistoryFragment | undefined = undefined;

            // Make sets out of these arrays for easy membership check:
            const requestedOpHistories = new Set<Hash>(req.requestedOpHistories);
            const informedAsFetchedOpHistories = new Set<Hash>(req.terminalFetchedOpHistories);
            const requestedOps = new Set<Hash>(req.requestedOps);

            // Validate received history

            if (req.expecting !== 'ops' && reply.history !== undefined) {
                newHistory = new CausalHistoryFragment(this.mutableObj);

                // Verify all received op history literals and create a fragment from 'em:
                for (const opHistoryLiteral of reply.history) {
                    try {
                        newHistory.add(new OpCausalHistory(opHistoryLiteral));
                    } catch (e) {
                        const detail = 'Error parsing op history literal ' + opHistoryLiteral.causalHistoryHash + ' received from ' + reqInfo.remote + ', cancelling request ' + reqInfo.request.requestId;
                        CausalHistorySyncAgent.controlLog.warning(detail); 
                        this.cancelRequest(reqInfo, 'invalid-reply', detail);
                        return;
                    }
                }

                // Check the reconstructed fragment does not provide more than one history for each mentioned op,
                // which would indicate an invalid history:
                if (!newHistory.verifyUniqueOps()) {
                    const detail = 'History received as reply to request ' + req.requestId + ' from ' + reqInfo.remote + ' contains duplicated histories for the same op, cancelling.';
                    CausalHistorySyncAgent.controlLog.warning(detail);
                    this.cancelRequest(reqInfo, 'invalid-reply', detail);
                    return;
                }

                // Check that the terminal op histories of the received fragment are amongst the requested histories
                
                for (const opHistoryHash of newHistory.terminalOpHistories) {
                    if (!requestedOpHistories.has(opHistoryHash)) {
                        const detail = 'Received op history ' + opHistoryHash + ' is terminal in the reconstructed fragment, but was not requested.';
                        CausalHistorySyncAgent.controlLog.warning(detail);
                        this.cancelRequest(reqInfo, 'invalid-reply', detail);
                        return;
                    }
                }

                // Check that the histories we sent as already known were not included
                if (req.terminalFetchedOpHistories !== undefined) {
                    for (const opHistoryHash of req.terminalFetchedOpHistories) {
                        if (newHistory.contents.has(opHistoryHash)) {
                            const detail = 'Received history contains op history ' + opHistoryHash + ' which was informed as already present in request ' + req.requestId + ', cancelling it.';
                            CausalHistorySyncAgent.controlLog.warning(detail);
                            this.cancelRequest(reqInfo, 'invalid-reply', detail);
                            return;
                        }
                    }
                }
             }

            // validate received ops
            
            // The reply MAY contain ops we didn't request, if they directly follow our stated current state.
            // Make a history fragment using this additional ops to check that is indeed the case.
            const additionalOpsHistory = new CausalHistoryFragment(this.mutableObj);

            if (req.expecting !== 'history' && reply.sendingOps !== undefined) {
                for (const hash of reply.sendingOps) {
                    if (!requestedOps.has(hash)) {
                        const opHistory = newHistory?.getOpHistoryForOp(hash);
                        if (opHistory === undefined) {
                            const detail = 'Received op hash ' + hash + ' cannot be justified, it is neither in requestedOps nor in the received history';
                            CausalHistorySyncAgent.controlLog.warning(detail);
                            this.cancelRequest(reqInfo, 'invalid-reply', detail);
                        } else {
                            additionalOpsHistory.add(opHistory);
                        }
                    }
                }

                // Check if the additional ops follow from provided history
                if (additionalOpsHistory.contents.size > 0) {
                    for (const opHistoryHash of additionalOpsHistory.missingOpHistories) {
                        if (reqInfo.request.expecting !== 'any' || !informedAsFetchedOpHistories.has(opHistoryHash)) {
                            const detail = 'Request informs it will send op with hash ' + additionalOpsHistory.contents.get(opHistoryHash)?.opHash + ', but it was neither requested or follows directly from informed fetched op histories.';
                            CausalHistorySyncAgent.controlLog.warning(detail);
                            this.cancelRequest(reqInfo, 'invalid-reply', detail);
                        }
                    }
                }
            }

            // OK, if we made it down here, the reply looks fairly solid.

            // Update the expected op history arrivals

            if (req.requestedOpHistories !== undefined) {
                for (const opHistoryHash of req.requestedOpHistories) {
                    this.requestsForOpHistory.delete(opHistoryHash, req.requestId)
                }
            }

            // Add newly received history

            if (newHistory !== undefined) {

                // Only add history for ops we have not yet received.
                // Do it backwards, so if new ops are added while this loop is running, we will never
                // add an op but omit one of its predecessors because it was stored in-between.

                for (const opHistory of newHistory.iterateFrom(newHistory.terminalOpHistories, 'backward')) {

                    if (this.store.loadOpCausalHistoryByHash(opHistory.causalHistoryHash) === undefined) {
                        this.discoveredHistory.add(opHistory);
                    }
                }
            }
            
            // Update expected op arrivals

             
            
        }

    }

    // Low-level: create requests, receive literals.

    private requestHistory(destination: Endpoint, requestedOpHistories: Set<Hash>) {
        this.request(destination, {requestedOpHistories: requestedOpHistories});
    }

    private requestOps(destination: Endpoint, requestedOps: Set<Hash>) {
        this.request(destination, {requestedOps: requestedOps});
    }

    private request(remote: Endpoint, aim: {requestedOpHistories?: Set<Hash>, requestedOps?: Set<Hash>}) {


        const msg: SyncRequestMsg = {
            type: MessageType.SyncRequest,
            requestId: new RNGImpl().randomHexString(128),
            mutableObj: this.mutableObj,
            expecting: aim.requestedOpHistories !== undefined? 'any' : 'ops',
        };

        if (aim.requestedOpHistories !== undefined) {
            msg.requestedOpHistories = Array.from(aim.requestedOpHistories.values());
            msg.terminalFetchedOpHistories = this.state === undefined? [] : Array.from(this.state.values());

            for (const opHistoryHash of msg.requestedOpHistories) {
                this.requestsForOpHistory.add(opHistoryHash, remote);
            }

            /*
            msg.terminalFetchedOpHistories  = Array.from(terminal.values( ));

            const known = new Set<Hash>();
            const miss  = new Set<Hash>();

            const start = this.discoveredFragment.terminalOpsFor(aim.requestedOpHistories, 'backward');

            for (const opHistory of start) {
                for (const prevOpHistoryHash of opHistory.prevOpHistories) {
                    if (this.store.loadOpCausalHistoryByHash(prevOpHistoryHash) !== undefined) {
                        known.add(prevOpHistoryHash);
                    } else {
                        miss.add(prevOpHistoryHash);
                    }
                }
            }

            const terminal = new Set<Hash>(known.values());

            if (miss.size > 0 && this.state !== undefined) {
                for (const opHistoryHash of this.state.values()) {
                    terminal.add(opHistoryHash);
                }
            }

            msg.terminalFetchedOpHistories  = Array.from(terminal.values( ));
            */
        }

        if (aim.requestedOps !== undefined) {
            msg.requestedOps = Array.from(aim.requestedOps.values());

            for (const opHash of msg.requestedOps) {
                this.requestsForOp.add(opHash, remote);
            }
        }
        
        if (msg.expecting !== 'history') {
            msg.omissionProofsSecret = new RNGImpl().randomHexString(128);
            msg.maxLiterals = 256;
        }

        if (msg.expecting !== 'ops') {
            msg.maxHistory = 256;
        }


        const reqInfo: SyncRequestInfo = {
            request: msg,
            remote: remote,
            status: 'created',
            sentTimestamp: Date.now()
        };


        this.requests.set(msg.requestId, reqInfo);

        if (this.currentRequests.get(remote).size < CausalHistorySyncAgent.MaxRequestsPerRemote) {
            this.sendRequest(reqInfo);
        } else {
            this.enqueueRequest(reqInfo);
        }
    }

    sendRequest(reqInfo: SyncRequestInfo) {
        const reqId = reqInfo.request.requestId;
        this.currentRequests.add(reqInfo.remote, reqId);
        this.dequeueRequest(reqInfo);
        this.sendMessageToPeer(reqInfo.remote, this.getAgentId(), reqInfo.request);
    }

    enqueueRequest(reqInfo: SyncRequestInfo) {
        const reqId = reqInfo.request.requestId;
        let queued = this.queuedRequests.get(reqInfo.remote);
        if (queued === undefined) {
            queued = [];
        }
        queued.push(reqId);
    }

    dequeueRequest(reqInfo: SyncRequestInfo) {
        const reqId = reqInfo.request.requestId;
        const queued = this.queuedRequests.get(reqInfo.remote);
        const idx = queued?.indexOf(reqId);

        if (idx !== undefined) {
            queued?.splice(idx);
        }
    }

    private cancelRequest(reqInfo: SyncRequestInfo, reason: 'invalid-reply'|'invalid-literal'|'out-of-order-literal'|'slow-connection'|'other', detail: string) {

        this.removeRequest(reqInfo);

        const msg: CancelSyncRequestMsg = {
            type: MessageType.CancelSyncRequest,
            requestId: reqInfo.request.requestId,
            reason: reason,
            detail: detail
        }

        this.sendMessageToPeer(reqInfo.remote, this.getAgentId(), msg);
    }

    private removeRequest(reqInfo: SyncRequestInfo) {

        const requestId = reqInfo.request.requestId;

        // remove pending ops

        if (reqInfo.request.requestedOps !== undefined) {
            for (const opHash of reqInfo.request?.requestedOps) {
                this.requestsForOp.delete(opHash, requestId);
            }
        }

        if (reqInfo.reply?.sendingOps !== undefined) {
            for (const opHash of reqInfo.reply?.sendingOps) {
                this.requestsForOp.delete(opHash, requestId);
            }
        }

        // remove pending opHistories

        if (reqInfo.request.requestedOpHistories !== undefined) {
            for (const opHistoryHash of reqInfo.request.requestedOpHistories) {
                this.requestsForOpHistory.delete(opHistoryHash, requestId)
            }
        }

        // remove from current & queue

        this.currentRequests.delete(reqInfo.remote, requestId);
        this.dequeueRequest(reqInfo);

    }

}

export { SyncMsg as HistoryMsg, CausalHistorySyncAgent }