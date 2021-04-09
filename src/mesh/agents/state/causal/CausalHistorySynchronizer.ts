import { RNGImpl } from 'crypto/random';

import { CausalHistoryFragment } from 'data/history/CausalHistoryFragment';
import { OpCausalHistory } from 'data/history/OpCausalHistory';
import { Context, Hash, HashedObject, Literal, LiteralUtils } from 'data/model';

import { Endpoint } from 'mesh/agents/network/NetworkAgent';

import { Logger, LogLevel } from 'util/logging';
import { MultiMap } from 'util/multimap';

import { CausalHistorySyncAgent } from '../CausalHistorySyncAgent';

import { ProviderLimits, RequestId, MessageType, SendLiteralMsg, RejectRequestMsg } from './CausalHistoryProvider';
import { RequestMsg, ResponseMsg, CancelRequestMsg } from './CausalHistoryProvider';

const MaxRequestsPerRemote = 2;

const RequestTimeout = 12;
const LiteralArrivalTimeout = 6;

type RequestInfo = {

    request   : RequestMsg,
    response? : ResponseMsg,

    remote : Endpoint,
    status : 'created'|'sent'|'queued'|'accepted-response',

    requestSendingTimestamp?  : number,
    responseArrivalTimestamp? : number,

    lastLiteralTimestamp?     : number,
    receivedLiteralsCount     : number,
    
    nextOpSequence            : number,
    nextLiteralSequence       : number,
    nextLiteralPromise?       : Promise<boolean>,

    outOfOrderLiterals    : Map<number, Literal>;

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

        if (newOpHistories.size > 0) {
            this.request(remote, { requestedOpHistories: newOpHistories});
        }
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

            if (resp.history !== undefined) {
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

            if (resp.sendingOps !== undefined) {
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
                    if (reqInfo.request.mode !== 'infer-req-ops') {
                        const detail = 'Response to request ' + req.requestId + ' includes additional ops, but mode is not infer-req-ops';
                        this.cancelRequest(reqInfo, 'invalid-response', detail);
                        return;
                    } else {
                        for (const opHistoryHash of additionalOpsHistory.missingPrevOpHistories) {
                            if (!informedAsFetchedOpHistories.has(opHistoryHash)) {
                                const detail = 'Request informs it will send an op depending upon another with history hash ' + opHistoryHash + ', but it was neither requested or follows directly from informed fetched op histories.';
                                this.cancelRequest(reqInfo, 'invalid-response', detail);
                                return;
                            }
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
                        CausalHistorySynchronizer.controlLog.warning('Reference chain for object ' + hash + ' is empty, cancelling request ' + req.requestId);
                        break;
                    }

                    const refOpLit = await this.syncAgent.store.loadLiteral(refOpHash);
                    if (refOpLit === undefined) {
                        omittedObjsOk = false;
                        CausalHistorySynchronizer.controlLog.warning('Referenced op in reference chain ' + refOpHash + ' not found locally, cancelling request ' + req.requestId);
                        break;
                    }

                    if (!this.syncAgent.literalIsValidOp(refOpLit)) {
                        omittedObjsOk = false;
                        CausalHistorySynchronizer.controlLog.warning('Referenced op ' + refOpHash + 'in reference chain for omitted obj ' + hash + ' is not a valid op, cancelling request ' + req.requestId);
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
                                CausalHistorySynchronizer.controlLog.warning('Referenced obj in reference chain ' + nextHash + ' not found locally, cancelling request ' + req.requestId);
                                break;
                            }
                        } else {
                            CausalHistorySynchronizer.controlLog.warning('Dep ' + nextHash + 'in reference chain for omitted obj ' + hash + ' not found amongst dependencies of ' + currLit.hash + ', cancelling request ' + req.requestId);                            
                            break;
                        }
                    }

                    if (referenceChain.length > 0) {
                        omittedObjsOk = false;
                        break;
                    }

                    if (currLit.hash !== hash) {
                        omittedObjsOk = false;
                        CausalHistorySynchronizer.controlLog.warning('Reference chain for omitted obj ' + hash + ' ends in another object: ' + currLit.hash + ', cancelling request ' + req.requestId);
                        break;
                    }

                    const ownershipProof = resp.omittedObjsOwnershipProofs[idx];
    
                    const dep = await this.syncAgent.store.load(hash);
    
                    if (dep === undefined || dep.hash(reqInfo.request.omissionProofsSecret) !== ownershipProof) {
                        omittedObjsOk = false;
                        CausalHistorySynchronizer.controlLog.warning('Omission proof for obj ' + hash + ' is wrong, cancelling request ' + req.requestId);                            
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

                    const isStored = await this.syncAgent.store.loadOpCausalHistoryByHash(opHistoryHash) !== undefined;
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

            this.attemptToProcessLiterals(reqInfo);

            reqInfo.status = 'accepted-response';
            
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

        if (reqInfo === undefined || reqInfo.remote !== remote) {

            if (reqInfo === undefined) {
                CausalHistorySynchronizer.controlLog.warning('Received literal for unknown request ' + msg.requestId);
            } else if (reqInfo.remote !== remote) {
                CausalHistorySynchronizer.controlLog.warning('Received literal claiming to come from ' + reqInfo.remote + ', but it actually came from ' + msg.requestId);
            }

            return;
        }

        let enqueue = false;
        let process = false;

        if (reqInfo.request.maxLiterals === undefined || reqInfo.receivedLiteralsCount < reqInfo.request.maxLiterals) {

            if (reqInfo.status === 'sent') {

                // if we are expecting ops
                if ( (reqInfo.request.requestedOps !== undefined && 
                    reqInfo.request.requestedOps.length > 0) ||
                    (reqInfo.request.mode === 'infer-req-ops' && 
                    reqInfo.request.requestedOpHistories !== undefined &&
                    reqInfo.request.requestedOpHistories.length > 0)) {

                        enqueue = true;

                }

            } else if (reqInfo.status === 'accepted-response' &&
                reqInfo.response !== undefined && 
                reqInfo.response.sendingOps !== undefined && reqInfo.nextOpSequence !== undefined) {

                enqueue = true;
                process = true;
                


            } else {
                CausalHistorySynchronizer.controlLog.warning('Received literal for request ' + msg.requestId + ' which is in unexpected state ' + reqInfo.status);
            }

            if (enqueue) {
                reqInfo.lastLiteralTimestamp  = Date.now();
                reqInfo.receivedLiteralsCount = reqInfo.receivedLiteralsCount + 1;
                if (reqInfo.request.maxLiterals === undefined || reqInfo.outOfOrderLiterals.size < reqInfo.request.maxLiterals) {
                    reqInfo.outOfOrderLiterals.set(msg.sequence, msg.literal);
                }
            }

            if (process) {
                this.attemptToProcessLiterals(reqInfo);
            }
        }

    }

    private async attemptToProcessLiterals(reqInfo: RequestInfo) {

        if (reqInfo.nextLiteralPromise !== undefined) {
            return;
        }

        while (reqInfo.outOfOrderLiterals.size > 0) {

            // Check if the request has not been cancelled
            if (this.requests.get(reqInfo.request.requestId) === undefined) {
                break;
            }

            const literal = reqInfo.outOfOrderLiterals.get(reqInfo.nextLiteralSequence);

            if (literal === undefined) {
                break;
            } else {

                reqInfo.outOfOrderLiterals.delete(reqInfo.nextLiteralSequence);
                reqInfo.nextLiteralPromise = this.processLiteral(reqInfo, literal);
                if (!await reqInfo.nextLiteralPromise) {
                    break;
                }
            }
        }

        reqInfo.nextLiteralPromise = undefined;
    }

    private async processLiteral(reqInfo: RequestInfo, literal: Literal): Promise<boolean> {
        

        if (!LiteralUtils.validateHash(literal)) {
            const detail = 'Wrong hash found when receiving literal ' + literal.hash + ' in response to request ' + reqInfo.request.requestId;
            this.cancelRequest(reqInfo, 'invalid-literal', detail);
            return false;
        }
        
        reqInfo.receivedObjects?.literals.set(literal.hash, literal);
        reqInfo.nextLiteralSequence = reqInfo.nextLiteralSequence + 1;

        if ((reqInfo.response?.sendingOps as Hash[])[reqInfo.nextOpSequence as number] === literal.hash) {

            if (this.syncAgent.literalIsValidOp(literal)) {
                
                try {
                    const op = HashedObject.fromContext(reqInfo.receivedObjects as Context, literal.hash, true);
                    reqInfo.nextOpSequence = reqInfo.nextOpSequence as number + 1;
                    await this.syncAgent.store.save(op);

                    
                    this.checkRequestRemoval(reqInfo);

                    const removed = this.checkRequestRemoval(reqInfo);
        
                    if (removed) {
                        this.attemptQueuedRequest(reqInfo.remote);
                    }

                } catch (e) {
                    const detail = 'Error while deliteralizing op ' + literal.hash + ' in response to request ' + reqInfo.request.requestId + '(op sequence: ' + reqInfo.nextOpSequence + ')';
                    this.cancelRequest(reqInfo, 'invalid-literal', detail);
                    CausalHistorySynchronizer.controlLog.warning(e);
                    CausalHistorySynchronizer.controlLog.warning('nextLiteralSquence='+reqInfo.nextLiteralSequence);
                    CausalHistorySynchronizer.controlLog.warning('receivedLiteralsCount='+reqInfo.receivedLiteralsCount)
                    return false;    
                }

            } else {
                const detail = 'Received op '+ literal.hash +' is not valid for mutableObj ' + this.syncAgent.mutableObj + ', in response to request ' + reqInfo.request.requestId + '(op sequence: ' + reqInfo.nextOpSequence + ')';
                this.cancelRequest(reqInfo, 'invalid-literal', detail);
                return false;
            }
        }

        return true;
    }

    // We're not rejecting anything for now, will implement when the retry logic is done.
    onReceivingRequestRejection(remote: Endpoint, msg: RejectRequestMsg) {
        remote; msg;
    }

    private async attemptNewRequest(remote: Endpoint, additionalPrevOpHistories?: Set<Hash>, additionalTerminalOpHistories?: Set<Hash>) {


        CausalHistorySynchronizer.controlLog.debug('About to attempt new request from ' + this.syncAgent.peerGroupAgent.getLocalPeer().endpoint + ' to ' + remote);
        CausalHistorySynchronizer.controlLog.trace('additionalPrevOpHistories: ', additionalPrevOpHistories);
        CausalHistorySynchronizer.controlLog.trace('additionalTerminalOpHistories: ', additionalTerminalOpHistories);


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

        CausalHistorySynchronizer.controlLog.trace('discoveredHistory: ' + this.discoveredHistory.contents.size);

        const remoteHistory = this.discoveredHistory.filterByTerminalOpHistories(remoteTerminalOps);

        CausalHistorySynchronizer.controlLog.trace('remoteHistory (filtered): ' + remoteHistory.contents.size);

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

        const opsToRequest = remoteHistory.causalClosure(providedOpHistores, ProviderLimits.MaxOpsToRequest, (h: Hash) => this.requestsForOpHistory.hasKey(h))
                             .map((opHistoryHash: Hash) => (remoteHistory.contents.get(opHistoryHash) as OpCausalHistory).opHash);

        // See if we need to follow up with another request:

        const doRequest = opHistoriesToRequest.size > 0 || opsToRequest.length > 0;

        if (doRequest) {
            CausalHistorySynchronizer.controlLog.trace('Doing new request for ' + opHistoriesToRequest.size + ' op histories and ' + opsToRequest.length + ' ops');
            this.request(remote, { requestedOpHistories: opHistoriesToRequest, requestedOps: opsToRequest });
        } else {
            CausalHistorySynchronizer.controlLog.trace('Not doing new request');
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
            mode: aim.requestedOpHistories !== undefined? 'infer-req-ops' : 'as-requested',
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
        
        if ((msg.requestedOps !== undefined) ||
            (msg.mode === 'infer-req-ops' && msg.requestedOpHistories !== undefined && msg.terminalFetchedOpHistories !== undefined)) {
            msg.omissionProofsSecret = new RNGImpl().randomHexString(128);
            msg.maxLiterals = ProviderLimits.MaxLiteralsPerResponse;
        }

        if (msg.requestedOpHistories !== undefined) {
            msg.maxHistory = ProviderLimits.MaxHistoryPerResponse;
        }


        const reqInfo: RequestInfo = {
            request: msg,
            remote: remote,
            status: 'created',
            nextOpSequence: 0,
            nextLiteralSequence: 0,
            receivedLiteralsCount: 0,
            outOfOrderLiterals: new Map(),
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
        reqInfo.status = 'sent';
        this.syncAgent.sendMessageToPeer(reqInfo.remote, this.syncAgent.getAgentId(), reqInfo.request);
    }

    private enqueueRequest(reqInfo: RequestInfo) {

        reqInfo.status = 'queued';

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