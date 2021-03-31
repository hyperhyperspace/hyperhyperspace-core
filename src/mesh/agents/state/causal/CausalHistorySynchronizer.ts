import { RNGImpl } from 'crypto/random';
import { CausalHistoryFragment } from 'data/history/CausalHistoryFragment';
import { OpCausalHistory } from 'data/history/OpCausalHistory';
import { Context, Hash, HashedObject, LiteralUtils } from 'data/model';
import { Endpoint } from 'mesh/agents/network/NetworkAgent';
import { SSL_OP_SSLEAY_080_CLIENT_DH_BUG } from 'node:constants';
import { Logger, LogLevel } from 'util/logging';
import { MultiMap } from 'util/multimap';
import { CausalHistorySyncAgent } from '../CausalHistorySyncAgent';

import { RequestId, MessageType, SendLiteralMsg, RejectRequestMsg } from './CausalHistoryProvider';
import { RequestMsg, ResponseMsg, CancelRequestMsg } from './CausalHistoryProvider';

const MaxRequestsPerRemote = 2;

const MaxLiteralsPerResponse = 256;
const MaxHistoryPerResponse = 256;

const MaxOpsToRequest = 128;

const RequestTimeout = 12;
const LiteralArrivalTimeout = 6;

type RequestInfo = {

    request   : RequestMsg,
    response? : ResponseMsg,

    remote : Endpoint,
    status : 'created'|'sent'|'queued',

    requestSendingTimestamp?  : number,
    responseArrivalTimestamp? : number,
    lastLiteralTimestamp?     : number,
    receivedLiteralsCount?      : number,
    nextOpSequence?           : number,

    receivedObjects? : Context
};

class CausalHistorySynchronizer {
    static controlLog = new Logger(CausalHistorySynchronizer.name, LogLevel.INFO);

    syncAgent: CausalHistorySyncAgent;

    discoveredHistory: CausalHistoryFragment;

    requests: Map<RequestId, RequestInfo>;

    requestsForOpHistory : MultiMap<Hash, RequestId>;
    requestsForOp        : MultiMap<Hash, RequestId>;

    currentRequests: MultiMap<Endpoint, RequestId>;
    queuedRequests: Map<Endpoint, RequestId[]>;
    

    constructor(syncAgent: CausalHistorySyncAgent) {

        this.syncAgent = syncAgent;
        
        this.discoveredHistory = new CausalHistoryFragment(this.syncAgent.mutableObj);

        this.requests = new Map();

        this.requestsForOpHistory = new MultiMap();
        this.requestsForOp        = new MultiMap();

        this.currentRequests = new MultiMap();
        this.queuedRequests  = new Map();
    }



    // Receiving end of sync

    // High-level: react to newly discovered history (opHistories found by gossip and replies to requests)
    
    // Upon discovering new opHistories, immediately ask for history + ops 
    // (if the ops follow after our current state)
    
    onNewHistory(remote: Endpoint, receivedOpHistories: Set<Hash>) {

        const newOpHistories = new Set<Hash>();

        for (const opHistory of receivedOpHistories) {
            if (!this.discoveredHistory.contents.has(opHistory)) {
                newOpHistories.add(opHistory);
            }
        }

        this.request(remote, { requestedOpHistories: newOpHistories});
    }

    async onReceivingResponse(remote: Endpoint, msg: ResponseMsg) {

        const reqInfo = this.requests.get(msg.requestId);

        // if request is known and was sent to 'remote' and unreplied as of now:
        if (reqInfo !== undefined && reqInfo.remote === remote && reqInfo.response === undefined) {
            reqInfo.response = msg;

            const req   = reqInfo.request;
            const resp = reqInfo.response;

            let receivedHistory: CausalHistoryFragment | undefined = undefined;

            // Make sets out of these arrays for easy membership check:
            const requestedOpHistories = new Set<Hash>(req.requestedOpHistories);
            const informedAsFetchedOpHistories = new Set<Hash>(req.terminalFetchedOpHistories);
            const requestedOps = new Set<Hash>(req.requestedOps);

            // Validate received history

            if (req.expecting !== 'ops' && resp.history !== undefined) {
                receivedHistory = new CausalHistoryFragment(this.syncAgent.mutableObj);

                // Verify all received op history literals and create a fragment from 'em:
                for (const opHistoryLiteral of resp.history) {
                    try {
                        receivedHistory.add(new OpCausalHistory(opHistoryLiteral));
                    } catch (e) {
                        const detail = 'Error parsing op history literal ' + opHistoryLiteral.causalHistoryHash + ' received from ' + reqInfo.remote + ', cancelling request ' + reqInfo.request.requestId;
                        this.cancelRequest(reqInfo, 'invalid-response', detail);
                        return;
                    }
                }

                // Check the reconstructed fragment does not provide more than one history for each mentioned op,
                // which would indicate an invalid history:
                if (!receivedHistory.verifyUniqueOps()) {
                    const detail = 'History received as reply to request ' + req.requestId + ' from ' + reqInfo.remote + ' contains duplicated histories for the same op, cancelling.';
                    this.cancelRequest(reqInfo, 'invalid-response', detail);
                    return;
                }

                // Check that the terminal op histories of the received fragment are amongst the requested histories
                
                for (const opHistoryHash of receivedHistory.terminalOpHistories) {
                    if (!requestedOpHistories.has(opHistoryHash)) {
                        const detail = 'Received op history ' + opHistoryHash + ' is terminal in the reconstructed fragment, but was not requested.';
                        this.cancelRequest(reqInfo, 'invalid-response', detail);
                        return;
                    }
                }

                // Check that the histories we sent as already known were not included
                if (req.terminalFetchedOpHistories !== undefined) {
                    for (const opHistoryHash of req.terminalFetchedOpHistories) {
                        if (receivedHistory.contents.has(opHistoryHash)) {
                            const detail = 'Received history contains op history ' + opHistoryHash + ' which was informed as already present in request ' + req.requestId + ', cancelling it.';
                            this.cancelRequest(reqInfo, 'invalid-response', detail);
                            return;
                        }
                    }
                }

                // Check that any received histories whose ops are already in the store are legit
                for (const opHistory of receivedHistory.contents.values()) {
                    const storedOpHistory = await this.syncAgent.store.loadOpCausalHistory(opHistory.opHash);

                    if (storedOpHistory !== undefined) {
                        if (storedOpHistory.causalHistoryHash !== opHistory.causalHistoryHash) {
                            const detail = 'Received history for op ' + opHistory.opHash + ' has causal hash of ' + opHistory.causalHistoryHash + ', but it does not match the already stored causal hash of ' + storedOpHistory.causalHistoryHash + ', discarding response for ' + req.requestId;
                            this.cancelRequest(reqInfo, 'invalid-response', detail);
                            return;
                        }
                    }
                }
             }

            // Validate response's sendingOps
            
            // The reply MAY contain ops we didn't request, if they directly follow our stated current state.
            // Make a history fragment using this additional ops to check that is indeed the case.
            const additionalOpsHistory = new CausalHistoryFragment(this.syncAgent.mutableObj);

            if (req.expecting !== 'history' && resp.sendingOps !== undefined) {
                for (const hash of resp.sendingOps) {
                    if (!requestedOps.has(hash)) {
                        const opHistory = receivedHistory?.getOpHistoryForOp(hash);
                        if (opHistory === undefined) {
                            const detail = 'Received op hash ' + hash + ' cannot be justified, it is neither in requestedOps nor in the received history';
                            this.cancelRequest(reqInfo, 'invalid-response', detail);
                            return;
                        } else {
                            additionalOpsHistory.add(opHistory);
                        }
                    }
                }

                // Check if the additional ops follow from provided history
                if (additionalOpsHistory.contents.size > 0) {
                    for (const opHistoryHash of additionalOpsHistory.missingPrevOpHistories) {
                        if (reqInfo.request.expecting !== 'any' || !informedAsFetchedOpHistories.has(opHistoryHash)) {
                            const detail = 'Request informs it will send op with hash ' + additionalOpsHistory.contents.get(opHistoryHash)?.opHash + ', but it was neither requested or follows directly from informed fetched op histories.';
                            this.cancelRequest(reqInfo, 'invalid-response', detail);
                            return;
                        }
                    }
                }
            }

            // If the response has any omission proofs, validate them

            if (resp?.omittedObjs !== undefined && resp.omittedObjs.length > 0) {
                if (resp?.sendingOps === undefined || resp.sendingOps.length === 0) {
                    const detail = 'Response includes ' + resp.omittedObjs.length + ' omitted objects, but it is not sending any ops - this makes no sense.';
                    this.cancelRequest(reqInfo, 'invalid-response', detail);
                    return;
                }

                if (resp?.omittedObjsReferenceChains === undefined || resp.omittedObjsReferenceChains.length !== resp.omittedObjs.length) {
                    const detail = 'Response includes ' + resp.omittedObjs.length + ' omitted objects but ' + resp.omittedObjsReferenceChains?.length + ' reference chains - they should be the same.';
                    this.cancelRequest(reqInfo, 'invalid-response', detail);
                    return;
                }


                if (resp?.omittedObjsOwnershipProofs === undefined || resp.omittedObjsOwnershipProofs.length !== resp.omittedObjs.length) {
                    const detail = 'Response includes ' + resp.omittedObjs.length + ' omitted objects but ' + resp.omittedObjsOwnershipProofs?.length + ' ownership proofs - they should be the same.';
                    this.cancelRequest(reqInfo, 'invalid-response', detail);
                    return;
                }


                let omittedObjsOk = true;

                for (const idx of resp.omittedObjs.keys()) {
                    const hash = resp.omittedObjs[idx];
                    const referenceChain = Array.from(resp.omittedObjsReferenceChains[idx]);

                    const refOpHash = referenceChain.shift();

                    if (refOpHash === undefined) {
                        omittedObjsOk = false;
                        break;
                    }

                    const refOpLit = await this.syncAgent.store.loadLiteral(refOpHash);
                    if (refOpLit === undefined) {
                        omittedObjsOk = false;
                        break;
                    }
                    const refOpFields = LiteralUtils.getFields(refOpLit);
                    const refOpClass = LiteralUtils.getClassName(refOpLit);
                    const acceptedOpClasses = this.syncAgent.acceptedMutationOpClasses as string[];
                    if (refOpFields['target'] !== this.syncAgent.mutableObj ||
                        acceptedOpClasses.indexOf(refOpClass) < 0) {
                        omittedObjsOk = false;
                        break;
                    }

                    let currLit = refOpLit;

                    while (referenceChain.length > 0) {
                        let foundDep = false;
                        const nextHash = referenceChain[0] as Hash;
                        for (const dep of currLit.dependencies) {
                            if (dep.hash === nextHash) {
                                foundDep = true;
                                break;
                            }
                        }
                        if (foundDep) {
                            const nextLit = await this.syncAgent.store.loadLiteral(nextHash);
                            if (nextLit !== undefined) {
                                currLit = nextLit;
                                referenceChain.shift();
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    }

                    if (referenceChain.length > 0) {
                        omittedObjsOk = false;
                        break;
                    }

                    let foundDep = false;
                    for (const dep of currLit.dependencies) {
                        if (dep.hash === hash) {
                            foundDep = true;
                            break;
                        }
                    }

                    if (!foundDep) {
                        omittedObjsOk = false;
                        break;
                    }

                    const ownershipProof = resp.omittedObjsOwnershipProofs[idx];
    
                    const dep = await this.syncAgent.store.load(hash);
    
                    if (dep === undefined || dep.hash(reqInfo.request.omissionProofsSecret) !== ownershipProof) {
                        omittedObjsOk = false;
                        break;
                    }
                }

                if (!omittedObjsOk) {
                    const detail = 'Detail not available.';
                    this.cancelRequest(reqInfo, 'invalid-omitted-objs', detail);
                    return;
                }

            }

            // OK, if we made it down here, the reply looks fairly solid.

            // Update the expected op history arrivals

            if (req.requestedOpHistories !== undefined) {
                for (const opHistoryHash of req.requestedOpHistories) {
                    this.requestsForOpHistory.delete(opHistoryHash, req.requestId)
                }
            }

            const newHistory = new CausalHistoryFragment(this.syncAgent.mutableObj);
            const newMissingPrevOpHistories = new Set<Hash>();

            // Add newly received history, recording what's new because we'll need it later

            if (receivedHistory !== undefined) {

                // Record if there are any new missingPrevOps we need to ask for

                for (const opHistoryHash of receivedHistory.missingPrevOpHistories.values()) {
                    const isStored = this.syncAgent.store.loadOpCausalHistoryByHash(opHistoryHash) !== undefined;
                    const isKnown  = this.discoveredHistory.contents.has(opHistoryHash);
                    const isKnownMissingPrevOp = this.discoveredHistory.missingPrevOpHistories.has(opHistoryHash);

                    if (!isStored && !isKnown && !isKnownMissingPrevOp) {
                    
                        newMissingPrevOpHistories.add(opHistoryHash);
                    }

                }

                // Record if we have discovered any new history that needs to be fetched

                for (const opHistory of receivedHistory.contents.values()) {

                    const opHistoryHash = opHistory.causalHistoryHash;

                    const isStored = this.syncAgent.store.loadOpCausalHistoryByHash(opHistoryHash) !== undefined;
                    const isKnown  = this.discoveredHistory.contents.has(opHistoryHash);

                    if (!isStored && !isKnown) {

                        newHistory.add(opHistory)
                    }
                }

                // Only add history for ops we have not yet received.
                // Do it backwards, so if new ops are added while this loop is running, we will never
                // add an op but omit one of its predecessors because it was stored in-between.

                for (const opHistory of newHistory.iterateFrom(newHistory.terminalOpHistories, 'backward')) {

                    this.discoveredHistory.add(opHistory);
                }
            }
            
            // Update expected op arrivals: delete what we asked and use what the server actually is sending instead

            if (req.requestedOps !== undefined) {
                for (const opHash of req.requestedOps) {
                    this.requestsForOp.delete(opHash, req.requestId);
                }
            }

            if (resp.sendingOps !== undefined) {
                for (const opHash of resp.sendingOps) {
                    this.requestsForOp.add(opHash, req.requestId);
                }
            }

            // Finally, if we are expecting ops after this response, validate and pre-load any omitted
            // dependencies.

            if (resp.sendingOps !== undefined && resp.sendingOps.length > 0) {
                reqInfo.receivedObjects = new Context();
                reqInfo.receivedLiteralsCount = 0;
                reqInfo.nextOpSequence        = 0;
            }

            if (resp.omittedObjsOwnershipProofs !== undefined &&
                resp.omittedObjs    !== undefined &&
                resp.omittedObjs.length === resp.omittedObjsOwnershipProofs.length) {

                for (const idx of resp.omittedObjs.keys()) {
                    const hash = resp.omittedObjs[idx];
                    const omissionProof = resp.omittedObjsOwnershipProofs[idx];
    
                    const dep = await this.syncAgent.store.load(hash);
    
                    if (dep !== undefined && dep.hash(reqInfo.request.omissionProofsSecret) === omissionProof) {
                        reqInfo.receivedObjects?.objects.set(dep.hash(), dep);
                    }
                }
    
            }
            
            const removed = this.checkRequestRemoval(reqInfo);
            
            if (removed) {
                this.attemptNewRequest(reqInfo.remote, newMissingPrevOpHistories, receivedHistory?.terminalOpHistories);                
            } else {
                this.attemptQueuedRequest(reqInfo.remote);
            }
        }

    }

    async onReceivingLiteral(remote: Endpoint, msg: SendLiteralMsg) {

        const reqInfo = this.requests.get(msg.requestId);

        if (reqInfo !== undefined && reqInfo.remote === remote && 
            reqInfo.response !== undefined && 
            reqInfo.response.sendingOps !== undefined && reqInfo.nextOpSequence !== undefined) {

            const literal = msg.literal;

            if (!LiteralUtils.validateHash(literal)) {
                const detail = 'Wrong hash found when receiving literal ' + literal.hash + ' in response to request ' + reqInfo.request.requestId;
                this.cancelRequest(reqInfo, 'invalid-literal', detail);
                return;
            }
            
            reqInfo.receivedObjects?.literals.set(literal.hash, literal);
            reqInfo.receivedLiteralsCount = reqInfo.receivedLiteralsCount as number + 1;
            reqInfo.lastLiteralTimestamp  = Date.now();

            if (reqInfo.response.sendingOps[reqInfo.nextOpSequence] === literal.hash) {

                const acceptedMutationOpClasses = this.syncAgent.acceptedMutationOpClasses as string[];
                const className = LiteralUtils.getClassName(literal);
                const target    = LiteralUtils.getFields(literal)['target']
    
                
                if (acceptedMutationOpClasses.indexOf(className) >= 0 &&
                    target === this.syncAgent.mutableObj) {
                    
                    try {
                        const op = HashedObject.fromContext(reqInfo.receivedObjects as Context, literal.hash, true);

                        await this.syncAgent.store.save(op);

                        reqInfo.nextOpSequence = reqInfo.nextOpSequence + 1;
                        this.checkRequestRemoval(reqInfo);

                        const removed = this.checkRequestRemoval(reqInfo);
            
                        if (removed) {
                            this.attemptQueuedRequest(reqInfo.remote);
                        }

                    } catch (e) {
                        const detail = 'Error while deliteralzing op ' + literal.hash + ' in response to request ' + reqInfo.request.requestId + '(op sequence: ' + reqInfo.nextOpSequence + ')';
                        this.cancelRequest(reqInfo, 'invalid-literal', detail);
                        return;    
                    }
                    
                        
                    

                } else {
                    const detail = 'Received op '+ literal.hash +' is not valid for mutableObj ' + this.syncAgent.mutableObj + ', in response to request ' + reqInfo.request.requestId + '(op sequence: ' + reqInfo.nextOpSequence + ')';
                    this.cancelRequest(reqInfo, 'invalid-literal', detail);
                    return;
                }
            }


        }

    }

    // We're not rejecting anything for now, will implement when I do the retry logic.
    onReceivingRequestRejection(remote: Endpoint, msg: RejectRequestMsg) {
        remote; msg;
    }

    private async attemptNewRequest(remote: Endpoint, additionalPrevOpHistories?: Set<Hash>, additionalTerminalOpHistories?: Set<Hash>) {

        const opHistoriesToRequest = new Set<Hash>(additionalPrevOpHistories);
        const remoteState = this.syncAgent.remoteStates.get(remote)
        
        if (remoteState !== undefined) {
            for (const opHistory of remoteState.values()) {
                if (!opHistoriesToRequest.has(opHistory) && 
                    !this.discoveredHistory.contents.has(opHistory) &&
                    !this.discoveredHistory.missingPrevOpHistories.has(opHistory) &&
                    !(this.requestsForOpHistory.get(opHistory).size > 0) &&
                    this.syncAgent.store.loadOpCausalHistoryByHash(opHistory) === undefined) {
                    
                        opHistoriesToRequest.add(opHistory);
                }
            }
 
        }

        const remoteTerminalOps = new Set<Hash>(additionalTerminalOpHistories);
        const remoteHistory = this.discoveredHistory.filterByTerminalOpHistories(remoteTerminalOps);

        const providedOpHistores = new Set<Hash>();

        for (const missingPrevOp of remoteHistory.missingPrevOpHistories) {
            if (await this.syncAgent.store.loadOpCausalHistoryByHash(missingPrevOp) !== undefined) {
                providedOpHistores.add(missingPrevOp);
            }
        }

        

        if (remoteState !== undefined) {
            for (const opHistory of remoteState.values()) {
                remoteTerminalOps.add(opHistory);
            }
        }

        const opsToRequest = remoteHistory.causalClosure(providedOpHistores, MaxOpsToRequest, (h: Hash) => this.requestsForOpHistory.hasKey(h))
                             .map((opHistoryHash: Hash) => (remoteHistory.contents.get(opHistoryHash) as OpCausalHistory).opHash);

        // See if we need to follow up with another request:

        const doRequest = opHistoriesToRequest.size > 0 || opsToRequest.length > SSL_OP_SSLEAY_080_CLIENT_DH_BUG;

        if (doRequest) {
            this.request(remote, { requestedOpHistories: opHistoriesToRequest, requestedOps: opsToRequest });
        }

        return doRequest;
    }

    private attemptQueuedRequest(remote: Endpoint) {
        const nextReqId = this.queuedRequests.get(remote)?.[0];

        const foundQueuedReq = nextReqId !== undefined;

        if (foundQueuedReq) {
            this.sendRequest(this.requests.get(nextReqId as string) as RequestInfo);
        }

        return foundQueuedReq;
    }

    // Low-level: create requests, receive literals.

    private request(remote: Endpoint, aim: {requestedOpHistories?: Set<Hash>, requestedOps?: Hash[]}) {


        const msg: RequestMsg = {
            type: MessageType.Request,
            requestId: new RNGImpl().randomHexString(128),
            mutableObj: this.syncAgent.mutableObj,
            expecting: aim.requestedOpHistories !== undefined? 'any' : 'ops',
        };

        if (aim.requestedOpHistories !== undefined) {
            msg.requestedOpHistories = Array.from(aim.requestedOpHistories.values());
            msg.terminalFetchedOpHistories = this.syncAgent.state === undefined? 
                                                [] 
                                             :
                                                Array.from(this.syncAgent.state.values());

            for (const opHistoryHash of msg.requestedOpHistories) {
                this.requestsForOpHistory.add(opHistoryHash, remote);
            }
        }

        if (aim.requestedOps !== undefined) {
            msg.requestedOps = Array.from(aim.requestedOps);

            for (const opHash of msg.requestedOps) {
                this.requestsForOp.add(opHash, remote);
            }
        }
        
        if (msg.expecting !== 'history') {
            msg.omissionProofsSecret = new RNGImpl().randomHexString(128);
            msg.maxLiterals = MaxLiteralsPerResponse;
        }

        if (msg.expecting !== 'ops') {
            msg.maxHistory = MaxHistoryPerResponse;
        }


        const reqInfo: RequestInfo = {
            request: msg,
            remote: remote,
            status: 'created',
            requestSendingTimestamp: Date.now()
        };


        this.requests.set(msg.requestId, reqInfo);

        if (this.currentRequests.get(remote).size < MaxRequestsPerRemote) {
            this.sendRequest(reqInfo);
        } else {
            this.enqueueRequest(reqInfo);
        }
    }

    private checkRequestRemoval(reqInfo: RequestInfo) {

        if (reqInfo.response === undefined && reqInfo.requestSendingTimestamp !== undefined &&
            Date.now() > reqInfo.requestSendingTimestamp + RequestTimeout * 1000) {

            // Remove due to timeout waiting for response.

            this.cancelRequest(reqInfo, 'slow-connection', 'Timeout waiting for response');
            this.removeRequest(reqInfo);
            return true;

        } else if (reqInfo.response !== undefined) {
            if (reqInfo.response.sendingOps === undefined || reqInfo.response.sendingOps.length === 0) {

                // This request is not sending any ops, so it can be removed as soon as there is a response

                this.removeRequest(reqInfo);
                return true;

            } else if (reqInfo.nextOpSequence === reqInfo.response.sendingOps.length) {

                // All the ops in the request have been received, it can be removed

                this.removeRequest(reqInfo);
                return true;

            } else {
                // Check if the receiving of the ops has not timed out

                let lastLiteralRequestTimestamp: number | undefined;

                if (reqInfo.lastLiteralTimestamp === undefined) {
                    if (reqInfo.responseArrivalTimestamp !== undefined) {
                        lastLiteralRequestTimestamp = reqInfo.responseArrivalTimestamp;
                    } else {
                        lastLiteralRequestTimestamp = reqInfo.requestSendingTimestamp;
                    }
                    
                } else {
                    lastLiteralRequestTimestamp = reqInfo.lastLiteralTimestamp;
                }

                if (lastLiteralRequestTimestamp !== undefined && Date.now() > lastLiteralRequestTimestamp + LiteralArrivalTimeout * 1000) {
                    this.cancelRequest(reqInfo, 'slow-connection', 'Timeout waiting for a literal to arrive');
                    this.removeRequest(reqInfo);
                    return true;
                }

            }
        }

        return false;

    }

    private sendRequest(reqInfo: RequestInfo) {
        const reqId = reqInfo.request.requestId;
        this.currentRequests.add(reqInfo.remote, reqId);
        this.dequeueRequest(reqInfo);
        this.syncAgent.sendMessageToPeer(reqInfo.remote, this.syncAgent.getAgentId(), reqInfo.request);
    }

    private enqueueRequest(reqInfo: RequestInfo) {
        const reqId = reqInfo.request.requestId;
        let queued = this.queuedRequests.get(reqInfo.remote);
        if (queued === undefined) {
            queued = [];
        }
        queued.push(reqId);
    }

    private dequeueRequest(reqInfo: RequestInfo) {
        const reqId = reqInfo.request.requestId;
        const queued = this.queuedRequests.get(reqInfo.remote);
        const idx = queued?.indexOf(reqId);

        if (idx !== undefined) {
            queued?.splice(idx);
        }
    }

    private cancelRequest(reqInfo: RequestInfo, reason: 'invalid-response'|'invalid-literal'|'out-of-order-literal'|'invalid-omitted-objs'|'slow-connection'|'other', detail: string) {

        CausalHistorySyncAgent.controlLog.warning(detail);

        this.removeRequest(reqInfo);

        const msg: CancelRequestMsg = {
            type: MessageType.CancelRequest,
            requestId: reqInfo.request.requestId,
            reason: reason,
            detail: detail
        }

        this.syncAgent.sendMessageToPeer(reqInfo.remote, this.syncAgent.getAgentId(), msg);
    }

    private removeRequest(reqInfo: RequestInfo) {

        const requestId = reqInfo.request.requestId;

        // remove pending ops

        if (reqInfo.response?.sendingOps !== undefined) {

            // If the request has a response, then requestsForOp has been
            // updated to expect what the response.sendingOps sepecifies

            for (const opHash of reqInfo.response?.sendingOps) {
                this.requestsForOp.delete(opHash, requestId);
            }
        } else if (reqInfo.request.requestedOps !== undefined) {

            // Otherwise, remove according to request.requestedOps

            for (const opHash of reqInfo.request?.requestedOps) {
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

        // remove request info

        this.requests.delete(reqInfo.request.requestId);

    }

}

export { CausalHistorySynchronizer };