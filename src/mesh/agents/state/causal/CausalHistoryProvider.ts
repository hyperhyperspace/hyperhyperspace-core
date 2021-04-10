import { CausalHistoryFragment } from 'data/history/CausalHistoryFragment';
import { OpCausalHistory, OpCausalHistoryLiteral } from 'data/history/OpCausalHistory';
import { Hash, HashedObject, Literal } from 'data/model';
import { ObjectPacker } from 'data/packing/ObjectPacker';
import { Endpoint } from 'mesh/agents/network/NetworkAgent';
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
    MaxLiteralsPerResponse: 1024,
    MaxHistoryPerResponse: 256
};

const LiteralBatchSize = 256;

type ResponseInfo = {

    request: RequestMsg,
    response?: ResponseMsg,
    remote: Endpoint,
    status: 'created'|'replied'|'queued',

    requestArrivalTimestamp: number,
    responseSentTimestamp?: number,
    lastLiteralTimestamp?: number,

    literalsToSend?: Array<Literal>,
    nextLiteralIdx?: number
}

class CausalHistoryProvider {

    syncAgent: CausalHistorySyncAgent;

    responses  : Map<RequestId, ResponseInfo>;   

    currentResponses: Map<Endpoint, RequestId>;
    queuedResponses: Map<Endpoint, RequestId[]>;

    streamingResponsesInterval?: any;
    streamingResponses: number;

    checkIfLiteralIsValidOp: (literal: Literal) => boolean;


    constructor(syncAgent: CausalHistorySyncAgent) {
        this.syncAgent = syncAgent;

        this.responses  = new Map();

        this.currentResponses  = new Map();
        this.queuedResponses   = new Map();

        this.streamingResponses = 0;

        this.checkIfLiteralIsValidOp = (literal: Literal) => this.syncAgent.literalIsValidOp(literal);

        this.continueStreamingResponses = this.continueStreamingResponses.bind(this);
    }


    continueStreamingResponses() {
        for (const requesId of this.currentResponses.values()) {
            const respInfo = this.responses.get(requesId);
            if (respInfo !== undefined) {

                this.sendLiterals(respInfo.request.requestId, LiteralBatchSize);

                if (this.isResponseComplete(respInfo)) {
                    this.removeResponse(respInfo);
                }
            }
        }
    }

    // TODO: check if we answer right away, or if we're already streaming literals
    //       from a previous request and this needs to be queued

    async onReceivingRequest(remote: Endpoint, msg: RequestMsg) {
        
        if (this.responses.get(msg.requestId) === undefined) {

            
            const respInfo: ResponseInfo = {
                request: msg,
                remote: remote,
                status: 'created',
                requestArrivalTimestamp: Date.now()
            };

            if (msg.mutableObj !== this.syncAgent.mutableObj) {
                const detail = 'Rejecting request ' + respInfo.request.requestId + ', mutableObj is ' + respInfo.request.mutableObj + ' but it should be ' + this.syncAgent.mutableObj;
                this.rejectRequest(respInfo, 'invalid-request', detail);
                return;
            } else {
                this.responses.set(msg.requestId, respInfo);

                if (this.currentResponses.get(remote) === undefined) {
                    this.sendResponse(respInfo);
                } else {
                    this.enqueueResponse(respInfo);
                }
            }
        }

    }



    //TODO
    onReceivingRequestCancellation(remote: Endpoint, msg: CancelRequestMsg) {
        remote; msg;
    }

    private async createResponse(respInfo: ResponseInfo): Promise<boolean> {

        const req = respInfo.request;

        const resp: ResponseMsg = {
            type: MessageType.Response,
            requestId: respInfo.request.requestId,
            literalCount: 0
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

                    if (!this.syncAgent.literalIsValidOp(literal)) {
                        const detail = 'Invalid requestedOpHistories/terminalFetchedOpHistories for request ' + respInfo.request.requestId + ', rejecting';
                        this.rejectRequest(respInfo, 'invalid-request', detail);
                        return false;
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
                    return false;
                }
            }
        }

        // Generate history fragment to include in the response

        const respHistoryFragment = new CausalHistoryFragment(this.syncAgent.mutableObj);

        let maxHistory = req.maxHistory;

        if (maxHistory === undefined || maxHistory > ProviderLimits.MaxHistoryPerResponse) {
            maxHistory = ProviderLimits.MaxHistoryPerResponse;
        }

        if (req.requestedOpHistories !== undefined && req.requestedOpHistories.length > 0) {

            await respHistoryFragment.loadFromTerminalOpHistories(
                this.syncAgent.store,
                new Set<Hash>(req.requestedOpHistories),
                maxHistory,
                new Set<Hash>(req.terminalFetchedOpHistories)
            );

            //console.log('loaded histories: ' + respHistoryFragment.contents.size);
            //console.log('requested:');
            //console.log(req.requestedOpHistories);

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

        // Collect the provided terminal ops, used to infer possible omissions for packing objects
        const providedOps = new Set<Hash>();

        // If any of the provided op histories are unknown, see if we can use discovered history to at
        // least map them to known ops
        const discoveredProvidedOpHistories = new Set<Hash>();
    
        // Iterate over provided terminal op histories, save the unknown ones
        for (const opHistoryHash of providedOpHistories) {
            const opHistory = await this.syncAgent.store.loadOpCausalHistoryByHash(opHistoryHash);
            if (opHistory !== undefined) {
                providedOps.add(opHistory.opHash);
            } else {
                const discoveredOpHistory = this.syncAgent.synchronizer.discoveredHistory.contents.has(opHistoryHash);
                if (discoveredOpHistory !== undefined) {
                    discoveredProvidedOpHistories.add(opHistoryHash);
                }
            }
        }

        // Try to map the unknwon ones, it there are any
        if (discoveredProvidedOpHistories.size > 0) {
            const providedFragment = this.syncAgent.synchronizer.discoveredHistory.filterByTerminalOpHistories(discoveredProvidedOpHistories);

            for (const opHistoryHash of providedFragment.missingPrevOpHistories) {
                const opHistory = await this.syncAgent.store.loadOpCausalHistoryByHash(opHistoryHash);   
                if (opHistory !== undefined) {
                    providedOps.add(opHistory.opHash);
                }
            }
        }
        
        
        let maxLiterals = respInfo.request.maxLiterals;
        if (maxLiterals === undefined || maxLiterals > ProviderLimits.MaxLiteralsPerResponse) {
            maxLiterals = ProviderLimits.MaxLiteralsPerResponse;
        }

        const packer = new ObjectPacker(this.syncAgent.store, maxLiterals);

        await packer.allowOmissionsRecursively(providedOps.values(), 2048, this.checkIfLiteralIsValidOp);

        let full = false;

        const sendingOps = new Array<Hash>();

        if (respInfo.request.requestedOps !== undefined) {
            //console.log('Trying to pack ' + respInfo.request.requestedOps.length + ' ops');
            for (const hash of respInfo.request.requestedOps) {
                if (!packer.allowedOmissions.has(hash)) {
                    full = !await packer.addObject(hash);

                    if (full) {
                        //console.log('Cannot pack, no room')
                        break;
                    } else {
                        //console.log('packed ' + hash);
                        //console.log(packer.content.length + ' literals packed so far');
                        sendingOps.push(hash);
                    }
    
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
                
                if (!packer.allowedOmissions.has(opHistory.opHash)) {
                    full = !await packer.addObject(opHistory.opHash);

                    if (full) {
                        break;
                    } else {
                        sendingOps.push(opHistory.opHash);
                    }    
                }


            }
        }

        // All set: send response

        if (packer.content.length > 0) {
            resp.sendingOps = sendingOps;
            resp.literalCount = packer.content.length;
            respInfo.literalsToSend = packer.content;
            respInfo.nextLiteralIdx = 0;
            
            if (packer.omissions.size > 0) {

                //console.log('omitting ' + packer.omissions.size + ' references');

                resp.omittedObjs = [];
                resp.omittedObjsReferenceChains = [];
                resp.omittedObjsOwnershipProofs = [];
                for (const [hash, refChain] of packer.omissions.entries()) {

                    resp.omittedObjs.push(hash);
                    resp.omittedObjsReferenceChains.push(refChain);
                    const dep = await this.syncAgent.store.load(hash) as HashedObject;
                    resp.omittedObjsOwnershipProofs.push(dep.hash(req.omissionProofsSecret))

                }
            }

        }

        respInfo.response = resp;

        return true;

    }

    private sendLiterals(requestId: RequestId, maxLiterals: number): number {
        const respInfo = this.responses.get(requestId);

        let sent = 0;

        if (respInfo?.literalsToSend !== undefined) {
            for (let i=0; i<maxLiterals; i++) {

                if (this.responses.get(requestId) === undefined) {
                    // this response is done
                    // (there could be overlap in the firing of 'sendStreamingResponses')
                    break;
                }

                const nextIdx = respInfo.nextLiteralIdx as number;

                if (nextIdx < respInfo.literalsToSend.length) {
                    try {
                        this.sendLiteral(respInfo, nextIdx, respInfo.literalsToSend[nextIdx]);
                    } catch (e) {
                        break;
                    }

                    respInfo.nextLiteralIdx = nextIdx + 1;
                    sent = sent + 1;
                } else {
                    break;
                }
            }
        }

        //TODO: check if respInfo can be cleaned up?
        //TODO: check if timer for sending should be enabled?

        return sent;
    }

    private sendLiteral(respInfo: ResponseInfo, sequence: number, literal: Literal) {

        const msg: SendLiteralMsg = {
            requestId: respInfo.request.requestId,
            type: MessageType.SendLiteral,
            sequence: sequence,
            literal: literal
        };

        this.syncAgent.sendMessageToPeer(respInfo.remote, this.syncAgent.getAgentId(), msg);

    }

    private rejectRequest(respInfo: ResponseInfo, reason: 'too-busy'|'invalid-request', detail: string) {

        CausalHistorySyncAgent.controlLog.warning(detail);

        this.removeResponse(respInfo);

        const msg: RejectRequestMsg = {
            type: MessageType.RejectRequest,
            requestId: respInfo.request.requestId,
            reason: reason,
            detail: detail
        };

        this.syncAgent.sendMessageToPeer(respInfo.remote, this.syncAgent.getAgentId(), msg);
    }

    private async sendResponse(respInfo: ResponseInfo) {
        const reqId = respInfo.request.requestId;
        this.currentResponses.set(respInfo.remote, reqId);
        this.dequeueResponse(respInfo);

        if (await this.createResponse(respInfo)) {
            this.syncAgent.sendMessageToPeer(respInfo.remote, this.syncAgent.getAgentId(), respInfo.response);
            
            if (respInfo.response?.literalCount as number > 0) {
                this.startStreamingResponse(respInfo);
            }

            if (this.isResponseComplete(respInfo)) {
                this.removeResponse(respInfo);
            }
        } else {
            this.removeResponse(respInfo);
        }


        

        
    }

    private enqueueResponse(respInfo: ResponseInfo) {
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

    private removeResponse(respInfo: ResponseInfo) {

        const requestId = respInfo.request.requestId;

        // remove from current & queue

        if (this.currentResponses.get(respInfo.remote) === requestId) {
            this.currentResponses.delete(respInfo.remote);
        }
        
        this.dequeueResponse(respInfo);

        // remove request info

        this.responses.delete(respInfo.request.requestId);

        if (this.isStreamingResponse(respInfo)) {
            this.streamingResponses = this.streamingResponses - 1;
            if (this.streamingResponses === 0 && this.streamingResponsesInterval !== undefined) {
                clearInterval(this.streamingResponsesInterval);
                this.streamingResponsesInterval = undefined;
            }
        }
    }

    private isResponseComplete(respInfo: ResponseInfo): boolean {

        const done = respInfo?.response !== undefined &&
                     (!this.isStreamingResponse(respInfo) ||
                     this.isStreamingCompleted(respInfo));
        
        return done;
        
    }

    private isStreamingResponse(respInfo: ResponseInfo): boolean {
        return respInfo.literalsToSend !== undefined;
    }

    private isStreamingCompleted(respInfo: ResponseInfo): boolean {
        return respInfo.literalsToSend !== undefined && 
               respInfo.nextLiteralIdx as number === respInfo.literalsToSend.length;
    }

    private startStreamingResponse(respInfo: ResponseInfo) {
        this.streamingResponses = this.streamingResponses + 1;

        if (this.streamingResponses === 1 && this.streamingResponsesInterval === undefined) {
            this.streamingResponsesInterval = setInterval(this.continueStreamingResponses, 100);
        }

        this.sendLiterals(respInfo.request.requestId, LiteralBatchSize);

    }

}

export { CausalHistoryProvider, ProviderLimits, RequestId, MessageType, SyncMsg, RequestMsg, ResponseMsg, RejectRequestMsg, SendLiteralMsg, CancelRequestMsg };