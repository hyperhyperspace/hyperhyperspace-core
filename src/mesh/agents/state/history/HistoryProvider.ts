import { HistoryDelta } from 'data/history/HistoryDelta';
import { HistoryFragment } from 'data/history/HistoryFragment';
import { OpHeader, OpHeaderLiteral } from 'data/history/OpHeader';
import { Hash, HashedObject, Literal } from 'data/model';
import { ObjectPacker } from 'data/packing/ObjectPacker';
import { Endpoint } from 'mesh/agents/network/NetworkAgent';
import { Logger, LogLevel } from 'util/logging';
import { HeaderBasedSyncAgent } from '../HeaderBasedSyncAgent';


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

    requestedTerminalOpHistory? : Hash[], // op histories we want to get
    requestedStartingOpHistory? : Hash[], // last op histories we got

    // If the target is too far from the point we have fetched so far, the other end will not
    // do the traversal for us. Hence we must fetch the history over several requests, and then
    // request the ops by their hashes using the following:
    requestedOps?: Hash[],
    currentState?: Hash[], // Caveat: state uses op history hashes !!!
    
    omissionProofsSecret?: string,
    
    maxHistory?: number,
    maxLiterals?: number
};

type ResponseMsg = {
    type: MessageType.Response,

    requestId: RequestId,
    
    history?: OpHeaderLiteral[],
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
    MaxOpsToRequest: 512,
    MaxLiteralsPerResponse: 1024,
    MaxHistoryPerResponse: 1024
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

class HistoryProvider {

    static controlLog = new Logger(HistoryProvider.name, LogLevel.INFO);
    static storeLog   = new Logger(HistoryProvider.name, LogLevel.INFO);
    static opXferLog  = new Logger(HistoryProvider.name, LogLevel.INFO);

    syncAgent: HeaderBasedSyncAgent;

    responses  : Map<RequestId, ResponseInfo>;   

    currentResponses: Map<Endpoint, RequestId>;
    queuedResponses: Map<Endpoint, RequestId[]>;

    streamingResponsesInterval?: any;
    streamingResponses: number;

    checkIfLiteralIsValidOp: (literal: Literal) => boolean;


    controlLog : Logger;
    storeLog   : Logger;
    opXferLog  : Logger;

    constructor(syncAgent: HeaderBasedSyncAgent) {
        this.syncAgent = syncAgent;

        this.responses  = new Map();

        this.currentResponses  = new Map();
        this.queuedResponses   = new Map();

        this.streamingResponses = 0;

        this.checkIfLiteralIsValidOp = (literal: Literal) => this.syncAgent.literalIsValidOp(literal);

        this.continueStreamingResponses = this.continueStreamingResponses.bind(this);

        this.controlLog = HistoryProvider.controlLog; 
        this.storeLog   = HistoryProvider.storeLog;
        this.opXferLog  = HistoryProvider.opXferLog;
    }


    continueStreamingResponses() {
        for (const requestId of this.currentResponses.values()) {
            const respInfo = this.responses.get(requestId);
            if (respInfo !== undefined) {
                this.sendLiterals(respInfo.request.requestId, LiteralBatchSize);
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

            if (msg.mutableObj !== this.syncAgent.mutableObjHash) {
                const detail = 'Rejecting request ' + respInfo.request.requestId + ', mutableObj is ' + respInfo.request.mutableObj + ' but it should be ' + this.syncAgent.mutableObjHash;
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



    
    onReceivingRequestCancellation(remote: Endpoint, msg: CancelRequestMsg) {

        const cancelledResp = this.responses.get(msg.requestId);

        if (cancelledResp !== undefined && cancelledResp.remote === remote) {
            this.removeResponse(cancelledResp);
            HistoryProvider.controlLog.debug('Received request cancellation for ' + msg.requestId);
        }
    }

    private async createResponse(respInfo: ResponseInfo): Promise<boolean> {

        await this.logStoreContents(respInfo.request.requestId);

        const req = respInfo.request;

        const resp: ResponseMsg = {
            type: MessageType.Response,
            requestId: respInfo.request.requestId,
            literalCount: 0
        }

        // Validate history request, if present
        if (respInfo.request.requestedTerminalOpHistory !== undefined || respInfo.request.requestedStartingOpHistory !== undefined) {

            const toCheck = new Set<Hash>();
            if (respInfo.request.requestedTerminalOpHistory !== undefined) {
                for (const hash of respInfo.request.requestedTerminalOpHistory) {
                    toCheck.add(hash);
                }
            }
            if (respInfo.request.requestedStartingOpHistory !== undefined) {
                for (const hash of respInfo.request.requestedStartingOpHistory) {
                    toCheck.add(hash);
                }
            }

            for (const opHistoryHash of toCheck) {
                const opHistory = await this.syncAgent.store.loadOpHeaderByHeaderHash(opHistoryHash);
                if (opHistory !== undefined) {
                    const literal = await this.syncAgent.store.loadLiteral(opHistory.opHash);

                    if (!this.syncAgent.literalIsValidOp(literal, true)) {
                        const detail = 'Invalid requestedTerminalOpHistory/requestedStartingOpHistory for request ' + respInfo.request.requestId + ', rejecting';
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

        // Validate sent state, if present

        const remoteStateOps = new Set<Hash>();

        if (respInfo.request.currentState !== undefined) {
            for (const opHistoryHash of respInfo.request.currentState) {
                const opHistory = await this.syncAgent.store.loadOpHeaderByHeaderHash(opHistoryHash);
                if (opHistory !== undefined) {
                    const literal = await this.syncAgent.store.loadLiteral(opHistory.opHash);

                    if (!this.syncAgent.literalIsValidOp(literal)) {
                        const detail = 'Invalid currentState for request ' + respInfo.request.requestId + ', rejecting';
                        this.rejectRequest(respInfo, 'invalid-request', detail);
                        return false;
                    }

                    remoteStateOps.add(opHistory.opHash);
                }
            }
        }

        // OK - Request is valid.

        // Generate history fragment to include in the response

        const respDelta = new HistoryDelta(this.syncAgent.mutableObjHash, this.syncAgent.store);

        let maxHistory = req.maxHistory;
        let maxOps     = req.maxLiterals;

        if (maxHistory === undefined || maxHistory > ProviderLimits.MaxHistoryPerResponse) {
            maxHistory = ProviderLimits.MaxHistoryPerResponse;
        }

        if (maxOps === undefined || maxOps > ProviderLimits.MaxOpsToRequest) {
            maxOps = ProviderLimits.MaxOpsToRequest;
        }

        let respHistoryFragment: HistoryFragment | undefined = undefined;

        if (req.requestedTerminalOpHistory !== undefined && req.requestedTerminalOpHistory.length > 0) {

            const start = req.requestedStartingOpHistory === undefined? [] : req.requestedStartingOpHistory;

            await respDelta.compute(req.requestedTerminalOpHistory, start, maxHistory, 512);
            respHistoryFragment = respDelta.fragment.filterByTerminalOpHeaders(new Set<Hash>(req.requestedTerminalOpHistory))

            if (respHistoryFragment.contents.size > 0) {
                resp.history = Array.from(respHistoryFragment.contents.values()).map((h: OpHeader) => h.literalize());
            }
        }
        
        let maxLiterals = respInfo.request.maxLiterals;
        if (maxLiterals === undefined || maxLiterals > ProviderLimits.MaxLiteralsPerResponse) {
            maxLiterals = ProviderLimits.MaxLiteralsPerResponse;
        }

        // TODO: only load packer if we're going to send ops
        const packer = new ObjectPacker(this.syncAgent.store, maxLiterals);

        await packer.allowOmissionsRecursively(remoteStateOps.values(), 2048, this.checkIfLiteralIsValidOp);

        let full = false;

        const sendingOps = new Array<Hash>();

        if (respInfo.request.requestedOps !== undefined) {
            
            for (const hash of respInfo.request.requestedOps) {

                if (sendingOps.length === maxOps) {
                    break;
                }

                if (!packer.allowedOmissions.has(hash)) {
                    full = !await packer.addObject(hash);

                    if (full) {
                        this.opXferLog.trace('Cannot pack ' + hash + ', no room.')
                        break;
                    } else {
                        this.opXferLog.trace('Packed ' + hash + '. ' + packer.content.length + ' literals packed so far.');
                        sendingOps.push(hash);
                    }
    
                } else {
                    this.opXferLog.debug('Cannot pack ' + hash + ': it is an allowed omision.\nreference chain is: ' + packer.allowedOmissions.get(hash));
                }
            }
        }

        if (!full &&
            respInfo.request.mode === 'infer-req-ops' &&
            respInfo.request.requestedTerminalOpHistory !== undefined &&
            respHistoryFragment !== undefined &&
            sendingOps.length < maxOps) {

            const start = new Set<Hash>(respInfo.request.currentState);
            const sending = new Set<Hash>();

            for (const opHash of sendingOps) {
                const opHistory = respHistoryFragment.getOpHeaderForOp(opHash);
                if (opHistory !== undefined) {
                    sending.add(opHistory.headerHash);
                }
            }

            const ignore = (opHistoryHash: Hash) => sending.has(opHistoryHash);            
            const extraOpsToSend = respHistoryFragment.causalClosure(start, maxOps - sendingOps.length, ignore);

            for (const opHistoryHash of extraOpsToSend) {
                const opHistory = respHistoryFragment.contents.get(opHistoryHash) as OpHeader;
                
                if (!packer.allowedOmissions.has(opHistory.opHash)) {
                    full = !await packer.addObject(opHistory.opHash);

                    if (full) {
                        break;
                    } else {
                        sendingOps.push(opHistory.opHash);
                    }    
                } else {
                    this.opXferLog.debug('Omitting one inferred op due tu allowed omission: ' + opHistory.opHash);
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

        if (respInfo !== undefined) {
            if (respInfo.literalsToSend !== undefined) {
                for (let i=0; i<maxLiterals; i++) {
    
                    if (this.responses.get(requestId) === undefined) {
                        // this response is done
                        // (there could be overlap in the firing of 'sendStreamingResponses')
                        break;
                    }
    
                    const nextIdx = respInfo.nextLiteralIdx as number;
    
                    if (nextIdx < respInfo.literalsToSend.length) {
                        try {
                            if (!this.sendLiteral(respInfo, nextIdx, respInfo.literalsToSend[nextIdx])) {
                                break;
                            }
                        } catch (e) {
                            break;
                        }
    
                        respInfo.nextLiteralIdx = nextIdx + 1;
                        sent = sent + 1;
                    } else {
                        break;
                    }
                }

                if (this.isResponseComplete(respInfo)) {
                    this.removeResponse(respInfo);
                }
            }
        }




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

        return this.syncAgent.sendMessageToPeer(respInfo.remote, this.syncAgent.getAgentId(), msg);

    }

    private rejectRequest(respInfo: ResponseInfo, reason: 'too-busy'|'invalid-request', detail: string) {

        HeaderBasedSyncAgent.controlLog.warning(detail);

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
        this.controlLog.debug('\nSending response for ' + reqId);
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

    private attemptQueuedResponse(remote: Endpoint) {

        const queued = this.queuedResponses.get(remote);

        if (queued !== undefined && queued.length > 0) {
            const reqId = queued.shift() as RequestId;
            this.controlLog.debug('\nFound queued request ' + reqId);
            const respInfo = this.responses.get(reqId) as ResponseInfo;
            this.sendResponse(respInfo);
            return true;
        } else {
            return false;
        }
    }

    private enqueueResponse(respInfo: ResponseInfo) {
        const reqId = respInfo.request.requestId;
        this.controlLog.debug('\nEnqueuing response for ' + reqId + ' currently processing ' + this.currentResponses.get(respInfo.remote));
        let queued = this.queuedResponses.get(respInfo.remote);
        if (queued === undefined) {
            queued = [];
            this.queuedResponses.set(respInfo.remote, queued);
        }
        queued.push(reqId);
    }

    private dequeueResponse(respInfo: ResponseInfo) {
        const reqId = respInfo.request.requestId;
        const queued = this.queuedResponses.get(respInfo.remote);
        const idx = queued?.indexOf(reqId);

        if (idx !== undefined && idx >= 0) {
            queued?.splice(idx);
        }
    }

    private removeResponse(respInfo: ResponseInfo) {

        const requestId = respInfo.request.requestId;

        if (this.responses.get(requestId) !== undefined) {
            this.controlLog.debug('Removing sent request ' + requestId);
            this.controlLog.debug('Queue after for ' + respInfo.remote + ': ' + this.queuedResponses.get(respInfo.remote));

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
    
            const queued = this.attemptQueuedResponse(respInfo.remote);

            this.controlLog.debug('Found following request after ' + requestId + ': ' + queued);
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

        if (this.streamingResponsesInterval === undefined) {
            this.streamingResponsesInterval = setInterval(this.continueStreamingResponses, 100);
        }

        this.sendLiterals(respInfo.request.requestId, LiteralBatchSize);

    }

    private async logStoreContents(requestId: string) {
        if (this.storeLog.level <= LogLevel.DEBUG) {
            this.storeLog.debug('\nStored state before response to request ' + requestId + '\n' + await this.syncAgent.lastStoredOpsDescription())            
        }
    }
}

export { HistoryProvider, ProviderLimits, RequestId, MessageType, SyncMsg, RequestMsg, ResponseMsg, RejectRequestMsg, SendLiteralMsg, CancelRequestMsg };