import { CausalHistoryFragment } from 'data/history/CausalHistoryFragment';
import { OpCausalHistory, OpCausalHistoryLiteral } from 'data/history/OpCausalHistory';
import { Hash, Literal } from 'data/model';
import { ObjectPacker } from 'data/packing/ObjectPacker';
import { Endpoint } from 'mesh/agents/network/NetworkAgent';
import { request } from 'node:http';
import { CausalHistorySyncAgent } from '../CausalHistorySyncAgent';


enum MessageType {
    Request        = 'request',
    Response       = 'response',
    RejectRequest  = 'reject-request',
    SendLiteral    = 'send-literal',
    CancelRequest  = 'cancel-request'
};

type RequestId = string;

type RequestMsg = {
    type: MessageType.Request,

    requestId: RequestId,
    
    mutableObj: Hash,
    
    mode: 'as-requested' | 'infer-req-ops';

    requestedOpHistories?       : Hash[], // op histories we want to get
    terminalFetchedOpHistories? : Hash[],  // last op histories whose op was already fetched

    // If the target is too far from the point we have fetched so far, the other end will not
    // do the traversal for us. Hence we must fetch the history over several requests, and then
    // request the ops by their hashes using the following:
    requestedOps?: Hash[],
    
    omissionProofsSecret?: string,
    
    maxHistory?: number,
    maxLiterals?: number
};

type ResponseMsg = {
    type: MessageType.Response,

    requestId: RequestId,
    
    history?: OpCausalHistoryLiteral[],
    sendingOps?: Hash[],

    omittedObjs?: Hash[],
    omittedObjsReferenceChains?: Hash[][],
    omittedObjsOwnershipProofs?: string[],

    literalCount: number
};

type RejectRequestMsg = {
    type: MessageType.RejectRequest,

    requestId: RequestId,

    reason: 'too-busy'|'invalid-request',
    detail: string
};

type SendLiteralMsg = {
    type: MessageType.SendLiteral,

    requestId: RequestId,

    sequence: number,
    literal: Literal
};

type CancelRequestMsg = {
    type: MessageType.CancelRequest,

    requestId: RequestId,
    reason: 'invalid-response'|'invalid-literal'|'invalid-omitted-objs'|'out-of-order-literal'|'slow-connection'|'other',
    detail: string
};

type SyncMsg = RequestMsg | ResponseMsg | RejectRequestMsg | SendLiteralMsg | CancelRequestMsg;

const ProviderLimits = {
    MaxOpsToRequest: 128,
    MaxLiteralsPerResponse: 256,
    MaxHistoryPerResponse: 256
};

type ResponseInfo = {

    request: RequestMsg,
    response?: ResponseMsg,
    remote: Endpoint,
    status: 'created'|'replied'|'queued',

    requestArrivalTimestamp: number,
    responseSentTimestamp?: number,
    lastLiteralTimestamp?: number,

    sendingQueue?: Array<Literal>

}

class CausalHistoryProvider {

    syncAgent: CausalHistorySyncAgent;

    responses  : Map<RequestId, ResponseInfo>;   

    currentResponses: Map<Endpoint, RequestId>;
    queuedResponses: Map<Endpoint, RequestId[]>;


    constructor(syncAgent: CausalHistorySyncAgent) {
        this.syncAgent = syncAgent;

        this.responses  = new Map();

        this.currentResponses  = new Map();
        this.queuedResponses   = new Map();
    }

    async onReceivingRequest(remote: Endpoint, msg: RequestMsg) {

        if (this.responses.get(msg.requestId) === undefined) {

            const respInfo: ResponseInfo = {
                request: msg,
                remote: remote,
                status: 'created',
                requestArrivalTimestamp: Date.now()
            };

            this.responses.set(msg.requestId, respInfo);

            const resp: ResponseMsg = {
                type: MessageType.Response,
                requestId: msg.requestId,
                literalCount: 0
            }

            if (respInfo.request.mutableObj !== this.syncAgent.mutableObj) {
                const detail = 'Rejecting request ' + respInfo.request.requestId + ', mutableObj is ' + respInfo.request.mutableObj + ' but it should be ' + this.syncAgent.mutableObj;
                this.rejectRequest(respInfo, 'invalid-request', detail);
                return;
            }

            // Validate history request, if present
            if (respInfo.request.requestedOpHistories !== undefined || respInfo.request.terminalFetchedOpHistories !== undefined) {

                const toCheck = new Set<Hash>();
                if (respInfo.request.requestedOpHistories !== undefined) {
                    for (const hash of respInfo.request.requestedOpHistories) {
                        toCheck.add(hash);
                    }
                }
                if (respInfo.request.terminalFetchedOpHistories !== undefined) {
                    for (const hash of respInfo.request.terminalFetchedOpHistories) {
                        toCheck.add(hash);
                    }
                }

                for (const opHistoryHash of toCheck) {
                    const opHistory = await this.syncAgent.store.loadOpCausalHistoryByHash(opHistoryHash);
                    if (opHistory !== undefined) {
                        const literal = await this.syncAgent.store.loadLiteral(opHistory.opHash);

                        if (this.syncAgent.literalIsValidOp(literal)) {
                            const detail = 'Invalid requestedOpHistories/terminalFetchedOpHistories for request ' + respInfo.request.requestId + ', rejecting';
                            this.rejectRequest(respInfo, 'invalid-request', detail);
                            return;
                        }
                    }
                }
            }

            // Validate requested ops, if present
            if (respInfo.request.requestedOps !== undefined) {

                for (const opHash of respInfo.request.requestedOps) {
                    const literal = await this.syncAgent.store.loadLiteral(opHash);
                    if (!this.syncAgent.literalIsValidOp(literal)) {
                        const detail = 'Invalid requestedOps for request ' + respInfo.request.requestId + ', rejecting';
                        this.rejectRequest(respInfo, 'invalid-request', detail);
                        return;
                    }
                }
            }

            // Generate history fragment to include in the response

            const respHistoryFragment = new CausalHistoryFragment(this.syncAgent.mutableObj);

            let maxHistory = msg.maxHistory;

            if (maxHistory === undefined || maxHistory > ProviderLimits.MaxHistoryPerResponse) {
                maxHistory = ProviderLimits.MaxHistoryPerResponse;
            }

            if (msg.requestedOpHistories !== undefined && msg.requestedOpHistories.length > 0) {
                
                respHistoryFragment.loadFromTerminalOpHistories(
                    this.syncAgent.store,
                    new Set<Hash>(msg.requestedOpHistories),
                    maxHistory,
                    new Set<Hash>(msg.terminalFetchedOpHistories)
                );

                if (respHistoryFragment.contents.size > 0) {

                    resp.history = Array.from(respHistoryFragment.contents.values()).map((h: OpCausalHistory) => h.literalize());
                }
            }

            const providedOpHistories = new Set<Hash>(respInfo.request.terminalFetchedOpHistories);

            const remoteState = this.syncAgent.remoteStates.get(respInfo.remote);

            if (remoteState !== undefined) {
                for (const opHistoryHash of remoteState.values()) {
                    providedOpHistories.add(opHistoryHash);
                }
            }

            const providedOps = new Set<Hash>();
        
            for (const opHistoryHash of providedOpHistories) {
                const opHistory = await this.syncAgent.store.loadOpCausalHistoryByHash(opHistoryHash);
                if (opHistory !== undefined) {
                    providedOps.add(opHistory.opHash);
                }
            }
            
            let maxLiterals = respInfo.request.maxLiterals;
            if (maxLiterals === undefined || maxLiterals > ProviderLimits.MaxLiteralsPerResponse) {
                maxLiterals = ProviderLimits.MaxLiteralsPerResponse;
            }

            const packer = new ObjectPacker(this.syncAgent.store, maxLiterals);

            packer.allowOmissionsRecursively(providedOps.values(), 2048);

            let full = false;

            if (respInfo.request.requestedOps !== undefined) {
                for (const hash of respInfo.request.requestedOps) {
                    full = !await packer.addObject(hash);

                    if (full) {
                        break;
                    }
                }
            }

            if (!full &&
                respInfo.request.mode === 'infer-req-ops' && 
                respHistoryFragment.contents.size > 0) {

                
                let ignore: ((h: Hash) => boolean) | undefined;

                // if necessary, make a function that will ignore ops we're already sending
                if (respInfo.request.requestedOps !== undefined) {
                    const toIgnore = new Set<Hash>();
                    for (const hash of respInfo.request.requestedOps) {
                        const opHistory = await this.syncAgent.store.loadOpCausalHistory(hash);
                        if (opHistory !== undefined) {
                            toIgnore.add(opHistory.opHash);
                        }
                    }

                    if (toIgnore.size > 0) {
                        ignore = (h: Hash) => toIgnore.has(h);
                    }
                }

                // The following does the actual work: find if, using the providedOpHistories we just dug out,
                // any of the op histories we're sending back can actually be sent in full.
                const moreOpHistories = respHistoryFragment.causalClosure(providedOpHistories, 512, ignore);

                for (const opHistoryHash of moreOpHistories) {
                    const opHistory = respHistoryFragment.contents.get(opHistoryHash) as OpCausalHistory;
                    
                    full = !await packer.addObject(opHistory.opHash);

                    if (full) {
                        break;
                    }

                }
            }

        }

    }

    onReceivingRequestCancellation(remote: Endpoint, msg: CancelRequestMsg) {

    }

    private rejectRequest(respInfo: ResponseInfo, reason: 'too-busy'|'invalid-request', detail: string) {

        CausalHistorySyncAgent.controlLog.warning(detail);

        this.removeResponse(respInfo);

        const msg: RejectRequestMsg = {
            type: MessageType.RejectRequest,
            requestId: respInfo.request.requestId,
            reason: reason,
            detail: detail
        }

        this.syncAgent.sendMessageToPeer(respInfo.remote, this.syncAgent.getAgentId(), msg);
    }

    private removeResponse(respInfo: ResponseInfo) {

        const requestId = respInfo.request.requestId;

        // remove from current & queue

        if (this.currentResponses.get(respInfo.remote) === requestId) {
            this.currentResponses.delete(respInfo.remote);
        }
        
        this.dequeueResponse(respInfo);

        // remove request info

        this.responses.delete(respInfo.request.requestId);
    }

    private sendResponse(respInfo: ResponseInfo) {
        const reqId = respInfo.request.requestId;
        this.currentResponses.set(respInfo.remote, reqId);
        this.dequeueResponse(respInfo);
        this.syncAgent.sendMessageToPeer(respInfo.remote, this.syncAgent.getAgentId(), respInfo.request);
    }

    private enqueueRequest(respInfo: ResponseInfo) {
        const reqId = respInfo.request.requestId;
        let queued = this.queuedResponses.get(respInfo.remote);
        if (queued === undefined) {
            queued = [];
        }
        queued.push(reqId);
    }

    private dequeueResponse(respInfo: ResponseInfo) {
        const reqId = respInfo.request.requestId;
        const queued = this.queuedResponses.get(respInfo.remote);
        const idx = queued?.indexOf(reqId);

        if (idx !== undefined) {
            queued?.splice(idx);
        }
    }

}


export { CausalHistoryProvider, ProviderLimits, RequestId, MessageType, SyncMsg, RequestMsg, ResponseMsg, RejectRequestMsg, SendLiteralMsg, CancelRequestMsg };