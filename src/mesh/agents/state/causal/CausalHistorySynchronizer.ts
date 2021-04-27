import { RNGImpl } from 'crypto/random';

import { CausalHistoryFragment } from 'data/history/CausalHistoryFragment';
import { OpCausalHistory, OpCausalHistoryLiteral } from 'data/history/OpCausalHistory';
import { Context, Hash, HashedObject, Literal, LiteralUtils, MutationOp } from 'data/model';

import { Endpoint } from 'mesh/agents/network/NetworkAgent';

import { Logger, LogLevel } from 'util/logging';
import { MultiMap } from 'util/multimap';
import { Lock } from 'util/concurrency';

import { CausalHistorySyncAgent } from '../CausalHistorySyncAgent';

import { ProviderLimits, RequestId, MessageType, SendLiteralMsg, RejectRequestMsg } from './CausalHistoryProvider';
import { RequestMsg, ResponseMsg, CancelRequestMsg } from './CausalHistoryProvider';

const MaxRequestsPerRemote = 2;
const MaxPendingOps = 1024;

const RequestTimeout = 20;
const LiteralArrivalTimeout = 10;

type RequestInfo = {

    request   : RequestMsg,
    response? : ResponseMsg,

    remote : Endpoint,
    status : 'created'|'sent'|'validating'|'accepted-response-processing'|'accepted-response-blocked'|'accepted-response',

    requestSendingTimestamp?  : number,
    responseArrivalTimestamp? : number,

    receivedHistory?          : CausalHistoryFragment,
    receivedOps?              : CausalHistoryFragment,

    lastLiteralTimestamp?     : number,
    receivedLiteralsCount     : number,
    
    nextOpSequence            : number,
    nextLiteralSequence       : number,
    nextLiteralPromise?       : Promise<boolean>,

    outOfOrderLiterals        : Map<number, Literal>;

    missingCurrentState?      : Set<Hash>; // uses op hashes!

    receivedObjects? : Context
};

class CausalHistorySynchronizer {
    static controlLog = new Logger(CausalHistorySynchronizer.name, LogLevel.DEBUG);
    static causalLog  = new Logger(CausalHistorySynchronizer.name, LogLevel.INFO);
    static sourcesLog = new Logger(CausalHistorySynchronizer.name, LogLevel.INFO);
    static stateLog   = new Logger(CausalHistorySynchronizer.name, LogLevel.INFO);
    static opXferLog  = new Logger(CausalHistorySynchronizer.name, LogLevel.DEBUG);
    static storeLog   = new Logger(CausalHistorySynchronizer.name, LogLevel.DEBUG);

    syncAgent: CausalHistorySyncAgent;

    endpointsForUnknownHistory : MultiMap<Hash, Endpoint>;

    currentState       : CausalHistoryFragment;

    discoveredHistory  : CausalHistoryFragment;
    remoteHistories    : Map<Hash, CausalHistoryFragment>;

    requests     : Map<RequestId, RequestInfo>;

    requestedOps : CausalHistoryFragment;

    requestsForOpHistory : MultiMap<Hash, RequestId>;
    requestsForOp        : MultiMap<Hash, RequestId>;

    activeRequests       : MultiMap<Endpoint, RequestId>;
    
    requestsBlockedByOpHistory : MultiMap<Hash, RequestId>;
    
    newRequestsLock: Lock;
    needToRetryNewRequests: boolean;

    readonly logPrefix: Hash;
    controlLog : Logger;
    causalLog  : Logger;
    sourcesLog : Logger;
    stateLog   : Logger;
    opXferLog  : Logger;
    storeLog   : Logger;

    constructor(syncAgent: CausalHistorySyncAgent) {

        this.syncAgent = syncAgent;

        this.currentState = new CausalHistoryFragment(this.syncAgent.mutableObj);

        this.endpointsForUnknownHistory = new MultiMap();
        
        this.discoveredHistory = new CausalHistoryFragment(this.syncAgent.mutableObj);
        this.remoteHistories   = new Map();

        this.requestedOps      = new CausalHistoryFragment(this.syncAgent.mutableObj);

        this.requests = new Map();

        this.requestsForOpHistory = new MultiMap();
        this.requestsForOp        = new MultiMap();

        this.activeRequests      = new MultiMap();
        this.requestsBlockedByOpHistory = new MultiMap();

        this.newRequestsLock = new Lock();
        this.needToRetryNewRequests = false;

        this.logPrefix = 'On peer ' + this.syncAgent.peerGroupAgent.localPeer.identity?.hash() as Hash + ':';

        this.controlLog = CausalHistorySynchronizer.controlLog;
        this.causalLog  = CausalHistorySynchronizer.causalLog;
        this.sourcesLog = CausalHistorySynchronizer.sourcesLog;
        this.stateLog   = CausalHistorySynchronizer.stateLog;
        this.opXferLog  = CausalHistorySynchronizer.opXferLog;
        this.storeLog   = CausalHistorySynchronizer.storeLog;
    }

    async onNewHistory(remote: Endpoint, receivedOpHistories: Set<Hash>) {


        this.controlLog.debug('\n'+this.logPrefix+'\nReceived new state from ' + remote);
        
        const newKnownHistory = new MultiMap<Endpoint, Hash>();

        for (const opHistory of receivedOpHistories) {
            if (await this.opHistoryIsMissingFromStore(opHistory)) {
                if (this.opHistoryIsUndiscovered(opHistory)) {
                    this.controlLog.debug('\n'+this.logPrefix+'\nAdding new unknown op history: ' + opHistory)
                    this.endpointsForUnknownHistory.add(opHistory, remote);    
                } else {
                    newKnownHistory.add(remote, opHistory);
                }
            }
        }

        if (newKnownHistory.size > 0) {
            this.updateRemoteHistories(newKnownHistory);
        }

        this.attemptNewRequests();
    }

    private async attemptNewRequests() {

        if (this.newRequestsLock.acquire()) {

            this.needToRetryNewRequests = true;
            while (this.needToRetryNewRequests) {
                try {
                    this.needToRetryNewRequests = false;
                    await this.attemptNewRequestsSerially();
                } catch (e) {
                    this.controlLog.error('\n'+this.logPrefix+'\nError while attempting new requests: ', e);
                }
            }
            
            this.newRequestsLock.release();
        } else {
            this.controlLog.trace('\n'+this.logPrefix+'\nNot attempting new request: could not acquire lock');
            this.needToRetryNewRequests = true;
        }


    }


    private async attemptNewRequestsSerially() {

        this.controlLog.debug('\n'+this.logPrefix+'\nAttempting new request...');

        if (this.endpointsForUnknownHistory.size === 0 && 
            this.discoveredHistory.missingPrevOpHistories.size === 0 && 
            this.discoveredHistory.contents.size === 0) {
            
            this.controlLog.debug('\n'+this.logPrefix+'\nThere is nothing to request.');
            return;
        }

        this.stateLog.trace('Unknown op histories: ', Array.from(this.endpointsForUnknownHistory.keys()));
        this.stateLog.trace('Missing prev op histories: ', this.discoveredHistory.missingPrevOpHistories);
        this.stateLog.trace('Pending op histories: ', Array.from(this.requestsForOpHistory.keys()));

        this.stateLog.trace('Current state', Array.from(this.currentState.contents.keys()));
        this.stateLog.trace('Discovered op histories', Array.from(this.discoveredHistory.contents.keys()));


        // Collect all op histories that need to be fetched, and which remotes have them
        const missingOpHistorySources = new MultiMap<Endpoint, Hash>();
        const missingOpHistories = new Set<Hash>();

        // First capture new ones picked up by gossip

        const opHistoryFromGossip = Array.from(this.endpointsForUnknownHistory.keys());



        for (const hash of opHistoryFromGossip) {
            
            const isUnrequested  = this.opHistoryIsUnrequested(hash); 
            
            if (isUnrequested) {
                const endpoints = this.endpointsForUnknownHistory.get(hash);
                const sources = new Array<Hash>();
                if (endpoints !== undefined) {
                    for (const ep of endpoints) {
                        if (this.canSendNewRequestTo(ep)) {
                            missingOpHistories.add(hash); // this way we only add it if there is at least one source
                            missingOpHistorySources.add(ep, hash); 
                            sources.push(ep);
                        } else {
                            this.controlLog.trace('\n'+this.logPrefix+'\nDiscarding endpoint ' + ep + ' as source of unknown op history ' + hash + ': no slot available for sending request.')
                        }
                    }    
                }

                this.sourcesLog.debug('\n'+this.logPrefix+'\nSources for unknown op history ' + hash + ': ', sources);
            } else {
                this.controlLog.trace('\n'+this.logPrefix+'\nIgnoring unknown op history ' + hash + ': it has already been requested.');
            }
        }

        // Next capture unknown histories at the edge of the discovered history fragment

        const opHistoryFromPrevOps = Array.from(this.discoveredHistory.missingPrevOpHistories);
        for (const hash of opHistoryFromPrevOps) {

            const isUnrequested = this.opHistoryIsUnrequested(hash);
            const isMissingFromStore = isUnrequested && await this.opHistoryIsMissingFromStore(hash);

            if (isUnrequested && isMissingFromStore) {

                const sources = new Array<Hash>();

                for (const ep of this.syncAgent.remoteStates.keys()) {
                    const history = this.remoteHistories.get(ep);

                    if (history !== undefined) {
                        if (history.missingPrevOpHistories.has(hash)) {
                            if (this.canSendNewRequestTo(ep)) {
                                missingOpHistories.add(hash); // this way we only add it if there is at least one source
                                missingOpHistorySources.add(ep, hash);
                                sources.push(ep);
                            } else {
                                this.controlLog.trace('\n'+this.logPrefix+'\nDiscarding endpoint ' + ep + ' as source of op history ' + hash + ': no slot available for sending request.')
                            }
                        }
                        
                    }
                }

                this.sourcesLog.debug('\n'+this.logPrefix+'\nSources for missing prev op history ' + hash + ': ', sources);
            } else {
                if (isUnrequested) {
                    this.controlLog.trace('\n'+this.logPrefix+'\nIgnoring missing prev op history ' + hash + ': it has already been requested.');
                } else {
                    this.controlLog.trace('\n'+this.logPrefix+'\nIgnoring missing prev op history ' + hash + ': it is present in the store.');
                }
                
            }
        }

        

        const sortedOpHistorySources = Array.from(missingOpHistorySources.entries());

        sortedOpHistorySources.sort((s1:[Endpoint, Set<Hash>], s2:[Endpoint, Set<Hash>]) => s2[1].size - s1[1].size);

        

        const opHistoriesToRequest = new Array<[Endpoint, Set<Hash>]>();

        this.controlLog.trace('\n'+this.logPrefix+'\nWill check ' + sortedOpHistorySources.length + ' remote sources');

        const considered = new Set<Endpoint>();

        for (const [ep, opHistories] of sortedOpHistorySources) {

            this.controlLog.trace('\n'+this.logPrefix+'\nConsidering remote ' + ep + ' with ' + opHistories.size + ' possible op histories...');
            
            const toRequest = new Set<Hash>();
            
            for (const opHistory of opHistories) {
                if (missingOpHistories.has(opHistory)) {
                    toRequest.add(opHistory);
                    missingOpHistories.delete(opHistory);
                }
            }

            if (toRequest.size > 0) {
                opHistoriesToRequest.push([ep, toRequest]);
                considered.add(ep);
            }

            if (missingOpHistories.size === 0) {
                break;
            }
        }

        for (const remote of this.remoteHistories.keys()) {
            if (!considered.has(remote)) {
                opHistoriesToRequest.push([remote, new Set<Hash>()]);
            }
        }

        for (const [remote, opHistories] of opHistoriesToRequest) {

            const startingOpHistories = this.computeStartingOpHistories();
            const startingOps         = this.computeStartingOps(remote);

            const ops = this.findOpsToRequest(remote, startingOps);

            const aim = {
                opHistories: opHistories,
                ops: ops
            };

            const current = {
                startingOpHistories: startingOpHistories,
                startingOps: startingOps
            };

            if (opHistories.size === 0 && ops.length === 0) {
                this.controlLog.debug('\n'+this.logPrefix+'\nFound no history or ops to request for remote ' + remote);
                continue;
            }

            if (this.controlLog.level <= LogLevel.DEBUG) {

                let debugInfo = '';            
    
                if (opHistories.size > 0) {
                    debugInfo = debugInfo + '\n';
                    debugInfo = debugInfo + 'Requesting op histories: [' + Array.from(opHistories) + ']\n';
                    debugInfo = debugInfo + '          starting from: [' + Array.from(current.startingOpHistories) + ']\n';
                }
    
                if (ops.length > 0) {
                    debugInfo = debugInfo + '\n';
                    debugInfo = debugInfo + 'Requesting ops:          [' + ops + ']\n';
                }
    
                if (opHistories.size > 0 || ops.length > 0) {
                    debugInfo = debugInfo + 'Starting point for ops:  [' + Array.from(current.startingOps) + ']\n';
                }

                this.controlLog.debug('\n'+this.logPrefix+debugInfo);
    
            }

            
            await this.logStoreContents();

            const sent = this.request(remote, aim, current);

            if (sent/* && ops.length > 0*/ && this.requestedOps.contents.size < MaxPendingOps) {
                
                // try to saturate the link: if there is room, make another request
                if (this.canSendNewRequestTo(remote) ) {
                    const startingOps = this.computeStartingOps(remote);
                    const ops = this.findOpsToRequest(remote, startingOps);

                    if (ops.length > 0) {

                        this.controlLog.debug('\n'+this.logPrefix+'\nRequesting an additional ' + ops.length + ' ops from remote ' + remote);

                        const aim = {ops: ops};
                        const current = { startingOps: startingOps };

                        this.request(remote, aim, current);
                    }
                }
            }
        }

    }

    private request(remote: Endpoint, aim: {opHistories?: Set<Hash>, ops?: Hash[]}, current?: {startingOpHistories?: Set<Hash>, startingOps?: Set<Hash>}, mode: ('infer-req-ops' | 'as-requested') ='infer-req-ops') {

        if (mode === undefined) {
            mode = this.requestedOps.contents.size < MaxPendingOps? 'infer-req-ops' : 'as-requested';
        }

        const msg: RequestMsg = {
            type: MessageType.Request,
            requestId: new RNGImpl().randomHexString(128),
            mutableObj: this.syncAgent.mutableObj,
            mode: mode
        };

        this.controlLog.debug('\n'+this.logPrefix+'\nRequesting ' + aim.opHistories?.size + ' op histories and ' + aim.ops?.length + ' ops from remote ' + remote + ' with requestId ' + msg.requestId);

        if (aim.opHistories !== undefined) {
            msg.requestedTerminalOpHistory = Array.from(aim.opHistories.values());

            let startingOpHistorySet: Set<Hash>;
            if (current?.startingOpHistories !== undefined) {
                startingOpHistorySet = current?.startingOpHistories;
            } else {
                startingOpHistorySet = this.computeStartingOpHistories();
            }

            msg.requestedStartingOpHistory = Array.from(startingOpHistorySet);
        }

        if (aim.ops !== undefined) {
            msg.requestedOps = Array.from(aim.ops);

            let startingOpsSet: Set<Hash>;
            if (current?.startingOps !== undefined) {
                startingOpsSet = current?.startingOps;
            } else {
                startingOpsSet = this.computeStartingOps(remote);
            }

            msg.currentState = Array.from(startingOpsSet);
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

        let sent = this.sendRequest(reqInfo);
        
        if (!sent) {
            this.cleanupRequest(reqInfo);
        }

        return sent;
    }

    // Do some intelligence over which ops can be requested from an endpoint

    private findOpsToRequest(remote: Endpoint, startingOps: Set<Hash>) {

        const remoteHistory = this.remoteHistories.get(remote);

        let max = MaxPendingOps - this.requestedOps.contents.size;
        if (max > ProviderLimits.MaxOpsToRequest) {
            max = ProviderLimits.MaxOpsToRequest;
        }
        if (max > 0 && remoteHistory !== undefined) {

            //console.log('STARTING OPS: ' + Array.from(startingOps));
            //console.log('MISSING PREV OPS: ' + Array.from(remoteHistory.missingPrevOpHistories));
            const ops = remoteHistory.causalClosure(startingOps, max, undefined, (h: Hash) => !this.requestsForOp.hasKey((remoteHistory.contents.get(h) as OpCausalHistory).opHash))
                                .map( (opHistoryHash: Hash) => 
                    (remoteHistory.contents.get(opHistoryHash) as OpCausalHistory).opHash );

            return ops;
        } else {
            return [];
        }
    }

    // Handle local state changes: remove arriving ops from discoveredHistory, remoteHistories,
    // requestedOps, requestsForOp, requestsForOpHistory, and endpointsForUnknownHistory.
    // Also check if there are any erroneos histories lingering for this op, remove them
    // and mark the peers as not trustworthy (TODO). 

    public async onNewLocalOp(op: MutationOp) {

        const prevOpCausalHistories: Map<Hash, OpCausalHistory> = new Map();

        for (const prevOpRef of op.getPrevOps()) {
            const prevOpHistory = await this.syncAgent.store.loadOpCausalHistory(prevOpRef.hash) as OpCausalHistory;
            prevOpCausalHistories.set(prevOpRef.hash, prevOpHistory);
        }

        const opHistories = this.discoveredHistory.getAllOpHistoriesForOp(op.getLastHash());

        for (const opHistory of opHistories) {

            if (!opHistory.verifyOpMatch(op, prevOpCausalHistories)) {
                this.processBadOpHistory(opHistory);
            } else {
                this.markOpAsFetched(opHistory);
            }
        }

        const opHistory = op.getCausalHistory(prevOpCausalHistories);
        this.addOpToCurrentState(opHistory);
    }

    private addOpToCurrentState(opHistory: OpCausalHistory) {
        this.currentState.add(opHistory);

        const terminal = new Set<Hash>(this.currentState.terminalOpHistories);

        for (const hash of Array.from(this.currentState.contents.keys())) {
            if (!terminal.has(hash)) {
                this.currentState.remove(hash);
            }
        }
        
    }

    async onReceivingResponse(remote: Endpoint, msg: ResponseMsg) {

        if (this.requests.get(msg.requestId)?.status !== 'sent') {
            this.controlLog.warning('\n'+this.logPrefix+'\nIgnoring response for request ' + msg.requestId + ": status is not 'sent'");
            return;
        }

        if (this.controlLog.level <= LogLevel.DEBUG) {

            let debugInfo = '';

            debugInfo = debugInfo + 'Received response for request ' + msg.requestId + ' from ' + remote + ' with ' + msg.history?.length + ' op histories, ' + msg.sendingOps?.length + ' ops and expecting ' + msg.literalCount + ' literals.\n';
            if (msg.history !== undefined) {
                debugInfo = debugInfo + 'Histories: [' + msg.history.map((opHistory: OpCausalHistoryLiteral) => opHistory.causalHistoryHash) + ']\n';
            }

            if (msg.sendingOps !== undefined) {
                debugInfo = debugInfo + '      Ops: [' + msg.sendingOps + ']\n';
            }
            
            this.controlLog.debug('\n'+this.logPrefix+'\n'+debugInfo);
        }



        if (await this.validateResponse(remote, msg)) {

            const reqInfo = this.requests.get(msg.requestId) as RequestInfo;
            const req  = reqInfo.request;

            reqInfo.status = 'accepted-response-blocked';
            reqInfo.missingCurrentState = new Set<Hash>(req.currentState);

            if (req.currentState !== undefined) {
                for (const opHistory of req.currentState.values()) {
                    if (await this.opHistoryIsMissingFromStore(opHistory)) {
                        this.requestsBlockedByOpHistory.add(opHistory, req.requestId);
                        this.controlLog.debug('\n'+this.logPrefix+'\nResuest ' + req.requestId + ' is blocked by missing op w/history ' + opHistory)
                    } else {
                        reqInfo.missingCurrentState.delete(opHistory);
                    }
                }
            }

            await this.attemptToProcessResponse(reqInfo);
            
        }


    }

    async onReceivingLiteral(remote: Endpoint, msg: SendLiteralMsg) {

        const reqInfo = this.requests.get(msg.requestId);

        if (reqInfo === undefined || reqInfo.remote !== remote) {

            if (reqInfo === undefined) {
                this.opXferLog.warning('\n'+this.logPrefix+'\nReceived literal for unknown request ' + msg.requestId);
            } else if (reqInfo.remote !== remote) {
                this.opXferLog.warning('\n'+this.logPrefix+'\nReceived literal claiming to come from ' + reqInfo.remote + ', but it actually came from ' + msg.requestId);
            }

            return;
        }

        let enqueue = false;
        let process = false;

        if (reqInfo.request.maxLiterals === undefined || reqInfo.receivedLiteralsCount < reqInfo.request.maxLiterals) {

            if (reqInfo.status !== 'accepted-response') {

                // if we are expecting ops
                if ( (reqInfo.request.requestedOps !== undefined && 
                    reqInfo.request.requestedOps.length > 0) ||
                    (reqInfo.request.mode === 'infer-req-ops' && 
                    reqInfo.request.requestedTerminalOpHistory !== undefined &&
                    reqInfo.request.requestedTerminalOpHistory.length > 0)) {

                        this.opXferLog.trace('\n'+this.logPrefix+'\nWill enqueue literal number ' + msg.sequence + ' for request ' + reqInfo.request.requestId);
                        enqueue = true;

                }

            } else { // reqInfo.status === 'accepted-response'

                this.opXferLog.trace('\n'+this.logPrefix+'\nWill process literal number ' + msg.sequence + ' for request ' + reqInfo.request.requestId);
                
                enqueue = true;
                process = true;
                
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

            if (!enqueue && !process) {
                this.opXferLog.warning('\n'+this.logPrefix+'\nWill ignore literal number ' + msg.sequence + ' for request ' + reqInfo.request.requestId);
            }

        } else {
            this.opXferLog.warning('\n'+this.logPrefix+'\nIgnored received literal for request ' + reqInfo.request.requestId + ', all literals were already received.');
        }

    }

    // We're not rejecting anything for now, will implement when the retry logic is done.
    onReceivingRequestRejection(remote: Endpoint, msg: RejectRequestMsg) {
        remote; msg;
    }

    private async attemptToProcessResponse(reqInfo: RequestInfo) {

        if (this.requests.get(reqInfo.request.requestId) === undefined) {
            this.controlLog.debug('\n'+this.logPrefix+'\nIgnoring response to ' + reqInfo.request.requestId + ', the request is no longer there.')
            return; // already processed
        }

        if (reqInfo.status !== 'accepted-response-blocked' || 
            (reqInfo.missingCurrentState as Set<Hash>).size > 0) {
            
            this.controlLog.debug('\n'+this.logPrefix+'\nIgnoring response to ' + reqInfo.request.requestId + ', the request is blocked by missing prevOps.');
            return;
        }

        reqInfo.status = 'accepted-response-processing';

        if (await this.validateOmissionProofs(reqInfo)) {
            const req = reqInfo.request;
            const resp = reqInfo.response as ResponseMsg;

            // Update the expected op history arrivals

            if (req.requestedTerminalOpHistory !== undefined) {
                for (const opHistoryHash of req.requestedTerminalOpHistory) {
                    this.requestsForOpHistory.delete(opHistoryHash, req.requestId)
                }
            }

            // Only add history for ops we have not yet received.
            // Do it backwards, so if new ops are added while this loop is running, we will never
            // add an op but omit one of its predecessors because it was stored in-between.

            if (reqInfo.receivedHistory !== undefined) {
                const rcvdHistory = reqInfo.receivedHistory;
                const newKnownHistoriesByRemote = new MultiMap<Hash, Endpoint>();
                for (const opHistory of rcvdHistory.iterateFrom(rcvdHistory.terminalOpHistories, 'backward', 'bfs')) {
                    if (await this.opHistoryIsMissingFromStore(opHistory.causalHistoryHash) && this.opHistoryIsUndiscovered(opHistory.causalHistoryHash)) {
                        this.discoveredHistory.add(opHistory);
                        const endpoints = this.endpointsForUnknownHistory.get(opHistory.causalHistoryHash);
                        for (const ep of endpoints.values()) {
                            newKnownHistoriesByRemote.add(ep, opHistory.causalHistoryHash);
                        }
                        this.endpointsForUnknownHistory.deleteKey(opHistory.causalHistoryHash);
                        this.requestsForOpHistory.delete(opHistory.causalHistoryHash, req.requestId)
                    }
                }

                this.updateRemoteHistories(newKnownHistoriesByRemote);
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
                resp.omittedObjs.length === resp.omittedObjsOwnershipProofs.length &&
                reqInfo.receivedObjects !== undefined) {

                this.opXferLog.trace('\n'+this.logPrefix+'\nHave to load ' + resp.omittedObjs.length + ' omitted deps for ' + req.requestId);

                for (const idx of resp.omittedObjs.keys()) {

                    const hash = resp.omittedObjs[idx];
                    const omissionProof = resp.omittedObjsOwnershipProofs[idx];
    
                    const dep = await this.syncAgent.store.load(hash);
    
                    if (dep !== undefined && dep.hash(reqInfo.request.omissionProofsSecret) === omissionProof) {
                        reqInfo.receivedObjects?.objects.set(dep.hash(), dep);
                    }
                }
    
                this.opXferLog.trace('\n'+this.logPrefix+'\nDone loading ' + resp.omittedObjs.length + ' omitted deps for ' + req.requestId);
            
            }

            

            reqInfo.status = 'accepted-response';

            await this.attemptToProcessLiterals(reqInfo);
            
            const removed = this.checkRequestRemoval(reqInfo);

            if (removed) {
                this.attemptNewRequests();                
            }
        }

    }

    private updateRemoteHistories(newKnownHistories: MultiMap<Endpoint, Hash>) {
        for (const ep of newKnownHistories.keys()) {

            let remoteHistory = this.remoteHistories.get(ep);
            if (remoteHistory === undefined) {
                remoteHistory = new CausalHistoryFragment(this.syncAgent.mutableObj);
                this.remoteHistories.set(ep, remoteHistory);
            }

            const oldKnownHistories = new Set<Hash>(remoteHistory.contents.keys());

            const filter = (opHistory: Hash) => !oldKnownHistories.has(opHistory);

            for (const hash of this.discoveredHistory.closureFrom(newKnownHistories.get(ep), 'backward', filter)) {
                const opHistory = this.discoveredHistory.contents.get(hash);
                if (opHistory !== undefined) {
                    remoteHistory.add(opHistory);
                }
            }
        }
    }

    private async attemptToProcessLiterals(reqInfo: RequestInfo) {

        if (reqInfo.nextLiteralPromise !== undefined) {
            this.opXferLog.trace('\n'+this.logPrefix+'\nSkipping attemptToProcessLiterals call for ' + reqInfo.request.requestId + ', there is a literal being processed already.')
            return;
        }

        this.opXferLog.trace('\n'+this.logPrefix+'\nCalled attemptToProcessLiterals for ' + reqInfo.request.requestId + ': ' + reqInfo.outOfOrderLiterals.size + ' literals to process');


        while (reqInfo.outOfOrderLiterals.size > 0 && reqInfo.receivedObjects !== undefined) {

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

                    this.opXferLog.debug('\n'+this.logPrefix+'\nReceived op ' + literal.hash + ' from request ' + reqInfo.request.requestId);
                    
                    this.checkRequestRemoval(reqInfo);

                    const removed = this.checkRequestRemoval(reqInfo);
        
                    if (removed) {
                        this.attemptNewRequests();
                    }

                } catch (e) {
                    const detail = 'Error while deliteralizing op ' + literal.hash + ' in response to request ' + reqInfo.request.requestId + '(op sequence: ' + reqInfo.nextOpSequence + ')';
                    this.cancelRequest(reqInfo, 'invalid-literal', '\n'+this.logPrefix+'\n'+detail);
                    this.opXferLog.warning(e);
                    this.opXferLog.warning('\n'+this.logPrefix+'\nnextLiteralSequence='+reqInfo.nextLiteralSequence);
                    this.opXferLog.warning('\n'+this.logPrefix+'\nreceivedLiteralsCount='+reqInfo.receivedLiteralsCount)
                    return false;    
                }

            } else {
                const detail = '\n'+this.logPrefix+'\nReceived op '+ literal.hash +' is not valid for mutableObj ' + this.syncAgent.mutableObj + ', in response to request ' + reqInfo.request.requestId + '(op sequence: ' + reqInfo.nextOpSequence + ')';
                this.cancelRequest(reqInfo, 'invalid-literal', detail);
                return false;
            }
        }

        return true;
    }

    private markOpAsFetched(opCausalHistory: OpCausalHistory) {

        this.opXferLog.debug('\n'+this.logPrefix+'\nMarking op ' + opCausalHistory.opHash + ' as fetched (op history is ' + opCausalHistory.causalHistoryHash + ').')

        const opHistoryHash = opCausalHistory.causalHistoryHash;
        const opHash        = opCausalHistory.opHash;

        this.discoveredHistory.remove(opHistoryHash);

        for (const history of this.remoteHistories.values()) {
            history.remove(opHistoryHash);
        }

        this.requestedOps.remove(opHistoryHash);
        this.requestsForOp.deleteKey(opHash);

        // in case we were trying to fetch history for this op
        this.markOpHistoryAsFetched(opHistoryHash);

        for (const requestId of this.requestsBlockedByOpHistory.get(opHistoryHash)) {
            const reqInfo = this.requests.get(requestId);

            if (reqInfo !== undefined) {
                this.opXferLog.debug('\n'+this.logPrefix+'\nAttempting to process blocked request ' + requestId);
                reqInfo.missingCurrentState?.delete(opHistoryHash);
                this.attemptToProcessResponse(reqInfo);
            } else {
                this.opXferLog.debug('\n'+this.logPrefix+'\nNot attempting to process blocked request ' + requestId + ': it is no longer there.');
            }
        }

        this.requestsBlockedByOpHistory.deleteKey(opHistoryHash);
    }

    private markOpHistoryAsFetched(opHistoryHash: Hash) {
        this.endpointsForUnknownHistory.deleteKey(opHistoryHash);
        this.requestsForOpHistory.deleteKey(opHistoryHash);
    }

    // TODO: identify peer as bad !
    private processBadOpHistory(opCausalHistory: OpCausalHistory) {
        this.markOpAsFetched(opCausalHistory);
    }

    private computeStartingOpHistories() {
        return this.terminalOpHistoriesPlusCurrentState(this.discoveredHistory);
    }

    private computeStartingOps(remote: Endpoint) {

        const remoteHistory = this.remoteHistories.get(remote);

        if (remoteHistory === undefined) {
            const currentState = new Set(this.currentState.contents.keys());
            
            const connectedRequestedOps = new CausalHistoryFragment(this.requestedOps.mutableObj);
            
            for (const hash of this.requestedOps.causalClosure(currentState)) {
                connectedRequestedOps.add(this.requestedOps.contents.get(hash) as OpCausalHistory);
            }
    
            return this.terminalOpHistoriesPlusCurrentState(connectedRequestedOps);    
        } else {
            const unrequested = remoteHistory.clone();

            for (const opHistory of this.requestedOps.contents.keys()) {
                unrequested.remove(opHistory);
            }

            return unrequested.missingPrevOpHistories;
        }

    }

    private terminalOpHistoriesPlusCurrentState(fragment: CausalHistoryFragment) {
        const startingOpHistories = new Set<Hash>(fragment.terminalOpHistories);

        for (const opHistory of this.currentState.contents.keys()) {
            if (!fragment.missingPrevOpHistories.has(opHistory)) {
                startingOpHistories.add(opHistory);
            }
        }

        return startingOpHistories;
    }

    private opHistoryIsUndiscovered(opHistory: Hash): boolean {
        return !this.discoveredHistory.contents.has(opHistory);
    }

    private opHistoryIsUnrequested(opHistory: Hash): boolean {
        return  this.requestsForOpHistory.get(opHistory).size === 0;
    }

    private async opHistoryIsMissingFromStore(opHistory: Hash): Promise<Boolean> {
        return await this.syncAgent.store.loadOpCausalHistoryByHash(opHistory) === undefined;
    }

    private async validateResponse(remote: Endpoint, msg: ResponseMsg): Promise<boolean> {
        
        const reqInfo = this.requests.get(msg.requestId);

        // if request is known and was sent to 'remote' and unreplied as of now:
        if (reqInfo !== undefined && reqInfo.remote === remote && reqInfo.response === undefined) {

            reqInfo.status = 'validating';
            reqInfo.response = msg;

            const req   = reqInfo.request;
            const resp = reqInfo.response;

            let receivedHistory: CausalHistoryFragment | undefined = undefined;

            // Make sets out of these arrays for easy membership check:
            const requestedOpHistories = new Set<Hash>(req.requestedTerminalOpHistory);
            //const informedAsFetchedOpHistories = new Set<Hash>(req.terminalFetchedOpHistories);
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
                        return false;
                    }
                }

                // Check the reconstructed fragment does not provide more than one history for each mentioned op,
                // which would indicate an invalid history:
                if (!receivedHistory.verifyUniqueOps()) {
                    const detail = 'History received as reply to request ' + req.requestId + ' from ' + reqInfo.remote + ' contains duplicated histories for the same op, cancelling.';
                    this.cancelRequest(reqInfo, 'invalid-response', detail);
                    return false;
                }

                // Check that the terminal op histories of the received fragment are amongst the requested histories
                for (const opHistoryHash of receivedHistory.terminalOpHistories) {
                    if (!requestedOpHistories.has(opHistoryHash)) {
                        const detail = 'Received op history ' + opHistoryHash + ' is terminal in the reconstructed fragment, but was not requested.';
                        this.cancelRequest(reqInfo, 'invalid-response', detail);
                        return false;
                    }
                }

                // Check that the histories we sent as already known were not included
                if (req.requestedStartingOpHistory !== undefined) {
                    for (const opHistoryHash of req.requestedStartingOpHistory) {
                        if (receivedHistory.contents.has(opHistoryHash)) {
                            const detail = 'Received history contains op history ' + opHistoryHash + ' which was informed as already present in request ' + req.requestId + ', cancelling it.';
                            this.cancelRequest(reqInfo, 'invalid-response', detail);
                            return false;
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
                            return false;
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
                            return false;
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
                        return false;
                    } else {
                        for (const opHistoryHash of additionalOpsHistory.missingPrevOpHistories) {
                            if (await this.syncAgent.store.loadOpCausalHistoryByHash(opHistoryHash) === undefined) {
                                const detail = 'Request informs it will send an op depending upon another with history hash ' + opHistoryHash + ', but it was neither requested or follows directly from informed fetched op histories.';
                                this.cancelRequest(reqInfo, 'invalid-response', detail);
                                return false;
                            }
                        }
                    }
                }

            }

            reqInfo.receivedHistory = receivedHistory;

            return true;
        } else {
            return false;
        }        
    }
    
    // If the response has any omission proofs, validate them
    private async validateOmissionProofs(reqInfo: RequestInfo): Promise<boolean> {

        const req  = reqInfo.request;
        const resp = reqInfo.response as ResponseMsg;

        if (resp?.omittedObjs !== undefined && resp.omittedObjs.length > 0) {
            if (resp?.sendingOps === undefined || resp.sendingOps.length === 0) {
                const detail = 'Response includes ' + resp.omittedObjs.length + ' omitted objects, but it is not sending any ops - this makes no sense.';
                this.cancelRequest(reqInfo, 'invalid-response', detail);
                return false;
            }

            if (resp?.omittedObjsReferenceChains === undefined || resp.omittedObjsReferenceChains.length !== resp.omittedObjs.length) {
                const detail = 'Response includes ' + resp.omittedObjs.length + ' omitted objects but ' + resp.omittedObjsReferenceChains?.length + ' reference chains - they should be the same.';
                this.cancelRequest(reqInfo, 'invalid-response', detail);
                return false;
            }


            if (resp?.omittedObjsOwnershipProofs === undefined || resp.omittedObjsOwnershipProofs.length !== resp.omittedObjs.length) {
                const detail = 'Response includes ' + resp.omittedObjs.length + ' omitted objects but ' + resp.omittedObjsOwnershipProofs?.length + ' ownership proofs - they should be the same.';
                this.cancelRequest(reqInfo, 'invalid-response', detail);
                return false;
            }


            let omittedObjsOk = true;

            for (const idx of resp.omittedObjs.keys()) {
                const hash = resp.omittedObjs[idx];
                const referenceChain = Array.from(resp.omittedObjsReferenceChains[idx]);

                const refOpHash = referenceChain.shift();

                if (refOpHash === undefined) {
                    omittedObjsOk = false;
                    this.controlLog.warning('\n'+this.logPrefix+'\nReference chain for object ' + hash + ' is empty, cancelling request ' + req.requestId);
                    break;
                }

                const refOpLit = await this.syncAgent.store.loadLiteral(refOpHash);
                if (refOpLit === undefined) {
                    omittedObjsOk = false;
                    this.controlLog.warning('\n'+this.logPrefix+'\nReferenced op in reference chain ' + refOpHash + ' not found locally, cancelling request ' + req.requestId);
                    break;
                }

                if (!this.syncAgent.literalIsValidOp(refOpLit)) {
                    omittedObjsOk = false;
                    this.controlLog.warning('\n'+this.logPrefix+'\nReferenced op ' + refOpHash + 'in reference chain for omitted obj ' + hash + ' is not a valid op, cancelling request ' + req.requestId);
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
                            this.controlLog.warning('\n'+this.logPrefix+'\nReferenced obj in reference chain ' + nextHash + ' not found locally, cancelling request ' + req.requestId);
                            break;
                        }
                    } else {
                        this.controlLog.warning('\n'+this.logPrefix+'\nDep ' + nextHash + 'in reference chain for omitted obj ' + hash + ' not found amongst dependencies of ' + currLit.hash + ', cancelling request ' + req.requestId);                            
                        break;
                    }
                }

                if (referenceChain.length > 0) {
                    omittedObjsOk = false;
                    break;
                }

                if (currLit.hash !== hash) {
                    omittedObjsOk = false;
                    this.controlLog.warning('\n'+this.logPrefix+'\nReference chain for omitted obj ' + hash + ' ends in another object: ' + currLit.hash + ', cancelling request ' + req.requestId);
                    break;
                }

                const ownershipProof = resp.omittedObjsOwnershipProofs[idx];

                const dep = await this.syncAgent.store.load(hash);

                if (dep === undefined || dep.hash(reqInfo.request.omissionProofsSecret) !== ownershipProof) {
                    omittedObjsOk = false;
                    this.controlLog.warning('\n'+this.logPrefix+'\nOmission proof for obj ' + hash + ' is wrong, cancelling request ' + req.requestId);                            
                    break;
                }
            }

            if (!omittedObjsOk) {
                const detail = 'Detail not available.';
                this.cancelRequest(reqInfo, 'invalid-omitted-objs', detail);
                return false;
            }

        }
        
        return true;
    }




    // request messaging (send, cancel)

    // request lifecycle

    private canSendNewRequestTo(remote: Endpoint) {
        const active = this.activeRequests.get(remote);
        return active.size < MaxRequestsPerRemote;
    }

    private sendRequest(reqInfo: RequestInfo) {
        
        reqInfo.status = 'sent';

        const reqId = reqInfo.request.requestId;
        this.requests.set(reqId, reqInfo);
        this.activeRequests.add(reqInfo.remote, reqId);
        
        if (reqInfo.request?.requestedOps !== undefined) {
            for (const hash of reqInfo.request?.requestedOps) {
                this.requestsForOp.add(hash, reqId);
            }
        }

        if (reqInfo.request.requestedTerminalOpHistory !== undefined) {
            for (const opHistoryHash of reqInfo.request.requestedTerminalOpHistory) {
                this.requestsForOpHistory.add(opHistoryHash, reqId)
            }
        }
        
        return this.syncAgent.sendMessageToPeer(reqInfo.remote, this.syncAgent.getAgentId(), reqInfo.request);
    }

    private cancelRequest(reqInfo: RequestInfo, reason: 'invalid-response'|'invalid-literal'|'out-of-order-literal'|'invalid-omitted-objs'|'slow-connection'|'other', detail: string) {

        CausalHistorySyncAgent.controlLog.warning('\n'+this.logPrefix+'\n'+detail);

        this.cleanupRequest(reqInfo);

        const msg: CancelRequestMsg = {
            type: MessageType.CancelRequest,
            requestId: reqInfo.request.requestId,
            reason: reason,
            detail: detail
        }

        this.syncAgent.sendMessageToPeer(reqInfo.remote, this.syncAgent.getAgentId(), msg);
    }

    private checkRequestRemoval(reqInfo: RequestInfo) {

        if (reqInfo.response === undefined && reqInfo.requestSendingTimestamp !== undefined &&
            Date.now() > reqInfo.requestSendingTimestamp + RequestTimeout * 1000) {

            // Remove due to timeout waiting for response.

            this.cancelRequest(reqInfo, 'slow-connection', 'Timeout waiting for response');
            this.cleanupRequest(reqInfo);
            return true;

        } else if (reqInfo.response !== undefined) {
            if (reqInfo.response.sendingOps === undefined || reqInfo.response.sendingOps.length === 0) {

                // This request is not sending any ops, so it can be removed as soon as there is a response

                this.cleanupRequest(reqInfo);
                return true;

            } else if (reqInfo.nextOpSequence === reqInfo.response.sendingOps.length) {

                // All the ops in the request have been received, it can be removed

                this.cleanupRequest(reqInfo);
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

                if (reqInfo.receivedLiteralsCount < reqInfo.response.literalCount && lastLiteralRequestTimestamp !== undefined && Date.now() > lastLiteralRequestTimestamp + LiteralArrivalTimeout * 1000) {
                    this.cancelRequest(reqInfo, 'slow-connection', 'Timeout waiting for a literal to arrive');
                    this.cleanupRequest(reqInfo);
                    return true;
                }

            }
        }

        return false;

    }

    private cleanupRequest(reqInfo: RequestInfo) {

        if (this.requests.get(reqInfo.request.requestId) === undefined) {
            return;
        }

        const requestId = reqInfo.request.requestId;

        if (reqInfo.request.currentState !== undefined) {
            for (const hash of reqInfo.request.currentState.values()) {
                this.requestsBlockedByOpHistory.delete(hash, requestId);
            }
        }

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

        if (reqInfo.request.requestedTerminalOpHistory !== undefined) {
            for (const opHistoryHash of reqInfo.request.requestedTerminalOpHistory) {
                this.requestsForOpHistory.delete(opHistoryHash, requestId)
            }
        }

        // remove from active

        this.activeRequests.delete(reqInfo.remote, requestId);

        // remove request info

        this.requests.delete(reqInfo.request.requestId);

    }

    private async logStoreContents() {
        if (this.storeLog.level <= LogLevel.DEBUG) {
            this.storeLog.debug('\n'+this.logPrefix+'\nStored state before request\n' + await this.syncAgent.lastStoredOpsDescription())            
        }
    }

}

export { CausalHistorySynchronizer };