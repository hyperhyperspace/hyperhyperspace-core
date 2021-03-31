import { OpCausalHistoryLiteral } from 'data/history/OpCausalHistory';
import { Hash, Literal } from 'data/model';
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
    
    expecting: 'history' | 'ops' | 'any';

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

    reason: 'too-busy'|'invalid-request'|'unknown-target'|'other',
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

type ResponseInfo = {

    request: RequestMsg,
    response: ResponseMsg,
    remote: Endpoint,
    status: 'created'|'replied'|'queued',

    repliedTimestamp?: number,
    lastLiteralTimestamp?: number,

    sendingQueue: Array<Literal>

}

class CausalHistoryProvider {

    syncAgent: CausalHistorySyncAgent;

    replies  : Map<RequestId, ResponseInfo>;   

    currentReplies: Map<Endpoint, RequestId>;
    queuedReplies: Map<Endpoint, RequestId[]>;


    constructor(syncAgent: CausalHistorySyncAgent) {
        this.syncAgent = syncAgent;

        this.replies  = new Map();

        this.currentReplies  = new Map();
        this.queuedReplies   = new Map();
    }

    onReceivingRequest(remote: Endpoint, msg: RequestMsg) {

    }

    onReceivingCancelRequest(remote: Endpoint, msg: CancelRequestMsg) {
        
    }

}


export { CausalHistoryProvider, RequestId, MessageType, SyncMsg, RequestMsg, ResponseMsg, RejectRequestMsg, SendLiteralMsg, CancelRequestMsg };