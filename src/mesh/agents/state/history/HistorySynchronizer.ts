import { RNGImpl } from 'crypto/random';

import { HistoryFragment } from 'data/history/HistoryFragment';
import { OpHeader, OpHeaderLiteral } from 'data/history/OpHeader';
import { Context, Hash, HashedObject, Literal, LiteralUtils, MutationOp } from 'data/model';

import { Endpoint } from 'mesh/agents/network/NetworkAgent';

import { Logger, LogLevel } from 'util/logging';
import { MultiMap } from 'util/multimap';
import { Lock } from 'util/concurrency';

import { HeaderBasedSyncAgent } from '../HeaderBasedSyncAgent';

import { ProviderLimits, RequestId, MessageType, SendLiteralMsg, RejectRequestMsg } from './HistoryProvider';
import { RequestMsg, ResponseMsg, CancelRequestMsg } from './HistoryProvider';

const MaxRequestsPerRemote = 2;
const MaxPendingOps = 1024;
const MinRequestedOps = 128;

const RequestTimeout = 32;
const LiteralArrivalTimeout = 16;

const MaxSavedCancelledRequests = 64;

const MaxLiteralsPerRequest = 512;
const MaxHistoryPerRequest = 1024;

type RequestInfo = {

    request   : RequestMsg,
    response? : ResponseMsg,

    remote : Endpoint,
    status : 'created'|'sent'|'validating'|'accepted-response-processing'|'accepted-response-blocked'|'accepted-response',

    requestSendingTimestamp?  : number,
    responseArrivalTimestamp? : number,

    receivedHistory?          : HistoryFragment,
    //receivedOps?              : HistoryFragment,

    lastLiteralTimestamp?     : number,
    receivedLiteralsCount     : number,
    
    nextOpSequence            : number,
    nextLiteralSequence       : number,
    nextLiteralPromise?       : Promise<boolean>,

    outOfOrderLiterals        : Map<number, Literal>;

    missingCurrentState?      : Set<Hash>; // uses op hashes!

    receivedObjects? : Context
};

class HistorySynchronizer {
    static controlLog  = new Logger(HistorySynchronizer.name, LogLevel.INFO);
    static sourcesLog  = new Logger(HistorySynchronizer.name, LogLevel.INFO);
    static stateLog    = new Logger(HistorySynchronizer.name, LogLevel.INFO);
    static opXferLog   = new Logger(HistorySynchronizer.name, LogLevel.INFO);
    static storeLog    = new Logger(HistorySynchronizer.name, LogLevel.INFO);
    static requestLog  = new Logger(HistorySynchronizer.name, LogLevel.INFO);
    static responseLog = new Logger(HistorySynchronizer.name, LogLevel.INFO);

    syncAgent: HeaderBasedSyncAgent;

    //endpointsForUnknownHistory : MultiMap<Hash, Endpoint>;

    discoveredHistory     : HistoryFragment;

    localStateFragment   : HistoryFragment;
    remoteStateFragments : Map<Endpoint, HistoryFragment>;
    //remoteHistories    : Map<Hash, CausalHistoryFragment>;

    requests     : Map<RequestId, RequestInfo>;

    requestedOps : HistoryFragment;

    requestsForOpHistory : MultiMap<Hash, RequestId>;
    requestsForOp        : MultiMap<Hash, RequestId>;

    activeRequests       : MultiMap<Endpoint, RequestId>;
    
    requestsBlockedByOpHeader : MultiMap<Hash, RequestId>;
    
    newRequestsLock: Lock;
    needToRetryNewRequests: boolean;

    checkRequestTimeoutsInterval?: any;

    lastCancelledRequests: Array<RequestId>;

    terminated = false;

    readonly logPrefix: Hash;
    controlLog  : Logger;
    sourcesLog  : Logger;
    stateLog    : Logger;
    opXferLog   : Logger;
    storeLog    : Logger;
    requestLog  : Logger;
    responseLog : Logger;

    constructor(syncAgent: HeaderBasedSyncAgent) {

        this.syncAgent = syncAgent;

        this.localStateFragment   = new HistoryFragment(this.syncAgent.mutableObjHash);
        this.remoteStateFragments = new Map();

        this.discoveredHistory = new HistoryFragment(this.syncAgent.mutableObjHash);
        
        this.requestedOps      = new HistoryFragment(this.syncAgent.mutableObjHash);

        this.requests = new Map();

        this.requestsForOpHistory = new MultiMap();
        this.requestsForOp        = new MultiMap();

        this.activeRequests      = new MultiMap();
        this.requestsBlockedByOpHeader = new MultiMap();

        this.newRequestsLock = new Lock();
        this.needToRetryNewRequests = false;

        this.checkRequestTimeouts = this.checkRequestTimeouts.bind(this);

        this.lastCancelledRequests = [];

        this.logPrefix = 'On peer ' + this.syncAgent.peerGroupAgent.localPeer.identity?.hash() as Hash + ':';

        this.controlLog  = HistorySynchronizer.controlLog;
        this.sourcesLog  = HistorySynchronizer.sourcesLog;
        this.stateLog    = HistorySynchronizer.stateLog;
        this.opXferLog   = HistorySynchronizer.opXferLog;
        this.storeLog    = HistorySynchronizer.storeLog;
        this.requestLog  = HistorySynchronizer.requestLog;
        this.responseLog = HistorySynchronizer.responseLog;
    }

    async onNewHistory(remote: Endpoint, receivedOpHistories: Set<OpHeader>) {


        this.controlLog.debug('\n'+this.logPrefix+'\nReceived new state from ' + remote);

        for (const opHistory of receivedOpHistories) {
            if (await this.opHistoryIsMissingFromStore(opHistory.headerHash)) {
                if (!this.discoveredHistory.contents.has(opHistory.headerHash)) {
                    this.discoveredHistory.add(opHistory);
                }

                this.addOpToRemoteState(remote, opHistory);
            }
        }

        this.attemptNewRequests();
    }

    checkRequestTimeouts() {

        let cancelledSome = false;

        for (const reqInfo of this.requests.values()) {

            const cancelled = this.checkRequestRemoval(reqInfo);

            if (cancelled) {
                HistorySynchronizer.controlLog.debug('Cancelled request ' + reqInfo.request.requestId + ' in timeout loop')
            }

            cancelledSome = cancelledSome || cancelled;
        }

        if (cancelledSome) {
            this.attemptNewRequests();
        }
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

        if (this.discoveredHistory.contents.size === 0) {  
            this.controlLog.debug('\n'+this.logPrefix+'\nThere is nothing to request.');
            return;
        }

        if (this.requestedOps.contents.size > MinRequestedOps) {
            this.controlLog.debug('\n'+this.logPrefix+'\nDelaying request, too many pending ops.');
            return;
        }

        if (this.stateLog.level <= LogLevel.DEBUG) {

            let debugInfo = '\n'+this.logPrefix+'\nState info before attempt:\n';

            const discHist =  Array.from(this.discoveredHistory.contents.keys());
            const pendingHist = Array.from(this.requestsForOpHistory.keys());
            const pendingOps = Array.from(this.requestsForOp.keys());
            debugInfo = debugInfo + '\nDiscovered op histories:   [' + discHist.slice(0, 8) + ( discHist.length > 8 ? ' ...' : '') + '] (count: ' + discHist.length + ')';    
            debugInfo = debugInfo + '\nMissing prev op histories: [' + Array.from(this.discoveredHistory.missingPrevOpHeaders) + ']';
            debugInfo = debugInfo + '\nPending op histories:      [' + pendingHist.slice(0, 8) + (pendingHist.length > 8 ? ' ...' : '') + '] (count: ' + pendingHist.length + ')';
            debugInfo = debugInfo + '\nPending ops:               [' + pendingOps.slice(0, 8) + (pendingOps.length > 8 ? ' ...' : '') + '] (count: ' + pendingOps.length + ')';
            debugInfo = debugInfo + '\nLocal state:               [' + Array.from(this.localStateFragment.contents.keys()) + ']';
            debugInfo = debugInfo + '\nRequests:                  [' + Array.from(this.requests.keys()).map((k: RequestId) => k + '(' + this.requests.get(k)?.status + ')') + ']';

            if (this.stateLog.level <= LogLevel.TRACE) {
                debugInfo = debugInfo + '\n\nDiscovered states by remote:';
                for (const [remote, history] of this.remoteStateFragments.entries()) {
                    debugInfo = debugInfo + '\n' + remote + ': [' + Array.from(history.contents.keys()) + ']';
                }
            }

            this.stateLog.debug(debugInfo);
        }

        // Compute remote histories
        const remoteHistories = this.computeRemoteHistories();

        // Collect all op histories that need to be fetched, and which remotes have them
        const missingOpHistorySources = new MultiMap<Endpoint, Hash>();
        const missingOpHistories = new Set<Hash>();

        // By capturing unknown op headers at the edge of the discovered history fragment

        const opHistoryFromPrevOps = Array.from(this.discoveredHistory.missingPrevOpHeaders);
        for (const hash of opHistoryFromPrevOps) {

            const isUnrequested = this.opHistoryIsUnrequested(hash);
            const isMissingFromStore = isUnrequested && await this.opHistoryIsMissingFromStore(hash);
            // (*) the above is short circuited like that only for performance: if it is not unrequested
            // it doesn't matter wheter it is in the store or not, we will not ask for it again.

            if (isUnrequested && isMissingFromStore) {

                const sources = new Array<Hash>();

                for (const ep of this.syncAgent.remoteStates.keys()) {
                    const history = remoteHistories.get(ep);

                    if (history !== undefined) {

                        if (history.missingPrevOpHeaders.has(hash)) {
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

                this.sourcesLog.trace('\n'+this.logPrefix+'\nSources for missing prev op history ' + hash + ': ', sources);
            } else {
                if (!isUnrequested) {
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

        for (const remote of remoteHistories.keys()) {
            if (!considered.has(remote)) {
                opHistoriesToRequest.push([remote, new Set<Hash>()]);
            }
        }

        const startingOpHistories = this.computeStartingOpHistories();

        let didSend = false;

        for (const [remote, opHistories] of opHistoriesToRequest) {

            
            const remoteHistory = remoteHistories.get(remote) as HistoryFragment;
            const startingOps = await this.computeStartingOps(remoteHistory);

            const ops = await this.findOpsToRequest(remoteHistory);

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
                    debugInfo = debugInfo + '\nNew request for ' + remote + '\n';
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

            if (this.storeLog.level <= LogLevel.DEBUG) {
                await this.logStoreContents();
            }
            

            const sent = this.request(remote, aim, current);

            if (sent/* && ops.length > 0*/ && this.requestedOps.contents.size < MaxPendingOps) {
                didSend = true;
                
                // try to saturate the link: if there is room, make another request
                if (this.canSendNewRequestTo(remote) ) {
                    const startingOps = await this.computeStartingOps(remoteHistory);
                    const ops = await this.findOpsToRequest(remoteHistory);

                    if (ops.length > 0) {

                        this.controlLog.debug('\n'+this.logPrefix+'\nRequesting an additional ' + ops.length + ' ops from remote ' + remote);

                        const aim = {ops: ops};
                        const current = { startingOps: startingOps };

                        this.request(remote, aim, current);
                    }
                }
            }
        }

        if (!didSend) {
            let blocked = false;
            for (const req of this.requests.values()) {
                if (req.status === 'accepted-response-blocked') {
                    blocked = true;
                    break;
                }
            }

            if (blocked) {
                // FIXME: do we want to log this?
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
            mutableObj: this.syncAgent.mutableObjHash,
            mode: mode,
            maxLiterals: MaxLiteralsPerRequest,
            maxHistory: MaxHistoryPerRequest

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

            if (current?.startingOps !== undefined) {
                msg.currentState = Array.from(current?.startingOps);
            } else {
                msg.currentState = Array.from(this.localStateFragment.contents.keys());//this.computeStartingOps(remote);
            }
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
        
        if (sent) {
            this.checkRequestTimeoutsTimer();    
        } else {
            this.cleanupRequest(reqInfo);
        }

        return sent;
    }

    private checkRequestTimeoutsTimer() {
        if (this.requests.size > 0) {
            if (this.checkRequestTimeoutsInterval === undefined) {
                this.checkRequestTimeoutsInterval = setInterval(this.checkRequestTimeouts, 5000);
            }
        } else {
            if (this.checkRequestTimeoutsInterval !== undefined) {
                clearInterval(this.checkRequestTimeoutsInterval);
                this.checkRequestTimeoutsInterval = undefined;
            }
        }
    }

    // Do some intelligence over which ops can be requested from an endpoint

    private async findOpsToRequest(remoteHistory: HistoryFragment) {

        let max = MaxPendingOps - this.requestedOps.contents.size;
        if (max > ProviderLimits.MaxOpsToRequest) {
            max = ProviderLimits.MaxOpsToRequest;
        }

        this.controlLog.debug('pending ops: ' + this.requestedOps.contents.size + ' can request ' + max + ' more');

        if (max > 0 && remoteHistory !== undefined) {

            const startingOps = new Set<Hash>();

            for (const missingStartingOp of remoteHistory.missingPrevOpHeaders) {
                if (this.requestsForOp.hasKey(missingStartingOp) || 
                    !(await this.opHistoryIsMissingFromStore(missingStartingOp))) {
                        startingOps.add(missingStartingOp);
                    }
            }

            const opHeaders = remoteHistory.causalClosure(startingOps, max, undefined, (h: Hash) => !this.requestsForOp.hasKey((remoteHistory.contents.get(h) as OpHeader).opHash))
            const ops = opHeaders.map( (opHeaderHash: Hash) => 
                                       (remoteHistory.contents.get(opHeaderHash) as OpHeader).opHash);


            const allRemoteOps = Array.from(remoteHistory.contents.keys());
            this.controlLog.debug('starting ops: ' + Array.from(startingOps));
            this.controlLog.debug('all remote ops: ' + allRemoteOps.slice(0, 8) + (allRemoteOps.length > 8 ? ' ...' : '') + ' (count: ' + allRemoteOps.length + ')');
            this.controlLog.debug('to request: ' + opHeaders.slice(0, 8) + (opHeaders.length > 8 ? ' ...' : '') + ' (count: ' + opHeaders.length + ')');

            return ops;
        } else {
            return [];
        }
    }

    /*
    private findOpsToRequest(remote: Endpoint, startingOps: Set<Hash>) {

        const remoteHistory = this.remoteHistories.get(remote);

        let max = MaxPendingOps - this.requestedOps.contents.size;
        if (max > ProviderLimits.MaxOpsToRequest) {
            max = ProviderLimits.MaxOpsToRequest;
        }
        if (max > 0 && remoteHistory !== undefined) {

            console.log('starting ops for findOpsToRequest from ' + remote + ' with max=' + max);
            console.log(Array.from(startingOps))

            const ops = remoteHistory.causalClosure(startingOps, max, undefined, (h: Hash) => !this.requestsForOp.hasKey((remoteHistory.contents.get(h) as OpCausalHistory).opHash))
                                .map( (opHistoryHash: Hash) => 
                    (remoteHistory.contents.get(opHistoryHash) as OpCausalHistory).opHash );

            console.log('found ops to request from ' + remote);
            console.log(ops);

            return ops;
        } else {
            return [];
        }
    }
    */

    // Handle local state changes: remove arriving ops from discoveredHistory, remoteHistories,
    // requestedOps, requestsForOp, requestsForOpHistory, and endpointsForUnknownHistory.
    // Also check if there are any erroneos histories lingering for this op, remove them
    // and mark the peers as not trustworthy (TODO). 

    public async onNewLocalOp(op: MutationOp) {

        const prevOpCausalHistories: Map<Hash, OpHeader> = new Map();

        for (const prevOpRef of op.getPrevOps()) {
            const prevOpHistory = await this.syncAgent.store.loadOpHeader(prevOpRef.hash) as OpHeader;
            prevOpCausalHistories.set(prevOpRef.hash, prevOpHistory);
        }

        const opHistories = this.discoveredHistory.getAllOpHeadersForOp(op.getLastHash());

        for (const opHistory of opHistories) {

            if (!opHistory.verifyOpMatch(op, prevOpCausalHistories)) {
                this.processBadOpHistory(opHistory);
            } else {
                this.markOpAsFetched(opHistory);
            }
        }

        const opHistory = op.getHeader(prevOpCausalHistories);
        
        this.addOpToCurrentState(opHistory);

        if (this.stateLog.level <= LogLevel.TRACE) {

            let debugInfo = this.logPrefix;
            debugInfo = debugInfo + '\nNew local op ' + op.hash() + ' causal: ' + opHistory.headerHash + ' -> [' + Array.from(opHistory.prevOpHeaders) + ']' ;
            debugInfo = debugInfo + '\nCurrent state now is: [' + Array.from(this.localStateFragment.contents.keys()) + ']';

            this.stateLog.trace(debugInfo);    
        }

    }

    private addOpToCurrentState(opHistory: OpHeader) {
        this.localStateFragment.add(opHistory);
        this.localStateFragment.removeNonTerminalOps();    
    }

    private addOpToRemoteState(remote: Endpoint, opHistory: OpHeader) {
        let remoteState = this.remoteStateFragments.get(remote);

        if (remoteState === undefined) {
            remoteState = new HistoryFragment(this.syncAgent.mutableObjHash);
            this.remoteStateFragments.set(remote, remoteState);
        }

        remoteState.add(opHistory);
        remoteState.removeNonTerminalOps();
    }

    private computeRemoteHistories(): Map<Endpoint, HistoryFragment> {

        const remoteHistories = new Map<Endpoint, HistoryFragment>();

        for (const [remote, state] of this.remoteStateFragments.entries()) {
            const history = this.discoveredHistory.filterByTerminalOpHeaders(new Set<Hash>(state.contents.keys()));
            remoteHistories.set(remote, history);
        }

        return remoteHistories;
    }

    async onReceivingResponse(remote: Endpoint, msg: ResponseMsg) {

        const req = this.requests.get(msg.requestId);

        if (req === undefined) {
            //TODO make this a debug message instead of a warning
            if (this.lastCancelledRequests.indexOf(msg.requestId) < 0) {
                this.controlLog.warning('\n'+this.logPrefix+'\nIgnoring response for unknown request ' + msg.requestId);
            }
            
            return
        }

        if (req?.status !== 'sent') {
            this.controlLog.warning('\n'+this.logPrefix+'\nIgnoring response for request ' + msg.requestId + ": status is not 'sent', but " + this.requests.get(msg.requestId)?.status);
            return;
        }

        if (this.controlLog.level <= LogLevel.DEBUG) {

            let debugInfo = '';

            debugInfo = debugInfo + 'Received response for request ' + msg.requestId + ' from ' + remote + ' with ' + msg.history?.length + ' op histories, ' + msg.sendingOps?.length + ' ops and expecting ' + msg.literalCount + ' literals.\n';
            if (msg.history !== undefined) {
                const histories = msg.history.map((opHistory: OpHeaderLiteral) => opHistory.headerHash);
                debugInfo = debugInfo + 'Histories: [' + histories.slice(0, 8) + ( histories.length > 8 ? ' ...' : '') + '] (count: ' + histories.length + ')\n';
            }

            if (msg.sendingOps !== undefined) {
                debugInfo = debugInfo + '      Ops: [' + msg.sendingOps.slice(0, 8) + (msg.sendingOps.length > 8 ? ' ...' : '') + '] (count: ' + msg.sendingOps.length + ')\n';
            }
            
            this.responseLog.debug('\n'+this.logPrefix+'\n'+debugInfo);
        }



        if (await this.validateResponse(remote, msg)) {

            const reqInfo = this.requests.get(msg.requestId) as RequestInfo;
            if (reqInfo !== undefined) {
                const req = reqInfo.request;

                reqInfo.status = 'accepted-response-blocked';
                reqInfo.missingCurrentState = new Set<Hash>(req.currentState);
    
                if (req.currentState !== undefined) {
                    for (const opHistory of req.currentState.values()) {
                        if (await this.opHistoryIsMissingFromStore(opHistory)) {
                            this.requestsBlockedByOpHeader.add(opHistory, req.requestId);
                            this.controlLog.debug('\n'+this.logPrefix+'\nRequest ' + req.requestId + ' is blocked by missing op w/history ' + opHistory)
                        } else {
                            reqInfo.missingCurrentState.delete(opHistory);
                        }
                    }
                }
    
                await this.attemptToProcessResponse(reqInfo);
                
                this.requestLog.debug('Received resp for ' + req.requestId);
            } else {
                this.requestLog.debug('Ignoring resp for ' + msg.requestId + ': it is valid, but it vanished during validation.');
            }

        } else {
            this.requestLog.debug('Received INVALID resp for ' + msg.requestId);
        }


    }

    async onReceivingLiteral(remote: Endpoint, msg: SendLiteralMsg) {

        const reqInfo = this.requests.get(msg.requestId);

        if (reqInfo === undefined || reqInfo.remote !== remote) {

            if (reqInfo === undefined) {
                if (this.lastCancelledRequests.indexOf(msg.requestId) < 0) {
                    this.opXferLog.warning('\n'+this.logPrefix+'\nReceived literal for unknown request ' + msg.requestId);
                } else {
                    this.opXferLog.debug('\n'+this.logPrefix+'\nReceived literal for cancelled request ' + msg.requestId);
                }
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

                        this.opXferLog.trace('\n'+this.logPrefix+'\nWill enqueue literal number ' + msg.sequence + ' for request ' + reqInfo.request.requestId + ' (status is ' + reqInfo.status + ')');
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
                await this.attemptToProcessLiterals(reqInfo);
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
            reqInfo.responseArrivalTimestamp = Date.now();

            // Update the expected op history arrivals

            if (req.requestedTerminalOpHistory !== undefined) {
                for (const opHistoryHash of req.requestedTerminalOpHistory) {
                    this.requestsForOpHistory.delete(opHistoryHash, req.requestId)
                }
            }

            // Only add history for ops we have not yet received.
            // Do it backwards, so if new ops are added while this loop is running, we will never
            // add an op but omit one of its predecessors because it was stored in-between.

            if (reqInfo.receivedHistory !== undefined && reqInfo.receivedHistory.contents.size > 0) {

                let addedOpHeaders = 0;
                let duplicatedOpHeaders = 0;
    

                const rcvdHistory = reqInfo.receivedHistory;
                for (const opHistory of rcvdHistory.iterateFrom(rcvdHistory.terminalOpHeaders, 'backward', 'bfs')) {
                    this.requestsForOpHistory.delete(opHistory.headerHash, req.requestId)
                    if (await this.opHistoryIsMissingFromStore(opHistory.headerHash) && this.opHistoryIsUndiscovered(opHistory.headerHash)) {
                        addedOpHeaders = addedOpHeaders + 1;                        
                        this.discoveredHistory.add(opHistory);
                    } else {
                        duplicatedOpHeaders = duplicatedOpHeaders + 1;
                    }
                }

                this.responseLog.debug('Imported ' + addedOpHeaders + ' new and ignored ' + duplicatedOpHeaders + ' duplicated op headers for request ' + req.requestId);
            }
            
            

            // Update expected op arrivals: delete what we asked and use what the server actually is sending instead

            if (req.requestedOps !== undefined) {
                for (const opHash of req.requestedOps) {
                    this.requestsForOp.delete(opHash, req.requestId);

                    if (this.requestsForOp.get(opHash).size === 0) {
                        for (const opHistory of this.discoveredHistory.getAllOpHeadersForOp(opHash)) {
                            this.requestedOps.remove(opHistory.headerHash);
                        }
                    }
                }
            }

            if (resp.sendingOps !== undefined) {
                for (const opHash of resp.sendingOps) {
                    this.requestsForOp.add(opHash, req.requestId);
                    for (const opHistory of this.discoveredHistory.getAllOpHeadersForOp(opHash)) {
                        this.requestedOps.add(opHistory);
                    }
                }
            }

            // Finally, if we are expecting ops after this response, validate and pre-load any omitted
            // dependencies.

            if (resp.sendingOps !== undefined && resp.sendingOps.length > 0) {
                reqInfo.receivedObjects = new Context();
                reqInfo.receivedObjects.resources = this.syncAgent.resources;
                if (this.syncAgent.mutableObj !== undefined) {
                    reqInfo.receivedObjects.objects.set(this.syncAgent.mutableObjHash, this.syncAgent.mutableObj);
                }
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
                        if (reqInfo.receivedObjects?.objects?.get(dep.hash()) === undefined) {
                            reqInfo.receivedObjects?.objects.set(dep.hash(), dep);
                        }
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
                const done = !await reqInfo.nextLiteralPromise;
                
                if (done) {
                    break;
                }
            }
        }

        reqInfo.nextLiteralPromise = undefined;
    }

    private async processLiteral(reqInfo: RequestInfo, literal: Literal): Promise<boolean> {

        // FIXME: but what about custom hashes?
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

                    // throws if validation fails
                    await HashedObject.fromContextWithValidation(reqInfo.receivedObjects as Context, literal.hash);

                    reqInfo.nextOpSequence = reqInfo.nextOpSequence as number + 1;
                    
                    await this.syncAgent.store.saveWithContext(literal.hash, reqInfo.receivedObjects as Context);

                    // FIXME: there's no validation of the op matching the actual causal history op
                    // TODO:  validate, remove op and all history following if op does not match

                    this.opXferLog.debug('\n'+this.logPrefix+'\nReceived op ' + literal.hash + ' from request ' + reqInfo.request.requestId + '(was requested: ' + (reqInfo.request.requestedOps !== undefined && reqInfo.request.requestedOps.indexOf(literal.hash) >= 0) + ') ');

                    const removed = this.checkRequestRemoval(reqInfo);

                    if (removed) {
                        this.attemptNewRequests();
                    }

                } catch (e: any) {
                    const detail = 'Error while deliteralizing op ' + literal.hash + ' in response to request ' + reqInfo.request.requestId + '(op sequence: ' + reqInfo.nextOpSequence + ')';
                    this.cancelRequest(reqInfo, 'invalid-literal', '\n'+this.logPrefix+'\n'+detail);
                    this.opXferLog.warning(e);
                    this.opXferLog.warning(e.stack);
                    this.opXferLog.warning('\n'+this.logPrefix+'\nnextLiteralSequence='+reqInfo.nextLiteralSequence);
                    this.opXferLog.warning('\n'+this.logPrefix+'\nreceivedLiteralsCount='+reqInfo.receivedLiteralsCount);
                    return false;    
                }

            } else {
                const detail = '\n'+this.logPrefix+'\nReceived op '+ literal.hash +' is not valid for mutableObj ' + this.syncAgent.mutableObjHash + ', in response to request ' + reqInfo.request.requestId + '(op sequence: ' + reqInfo.nextOpSequence + ')';
                this.cancelRequest(reqInfo, 'invalid-literal', detail);
                return false;
            }
        }

        return true;
    }

    private markOpAsFetched(opHeader: OpHeader) {

        this.opXferLog.debug('\n'+this.logPrefix+'\nMarking op ' + opHeader.opHash + ' as fetched (op history is ' + opHeader.headerHash + ').')

        const opHeaderHash = opHeader.headerHash;
        const opHash        = opHeader.opHash;



        for (const state of this.remoteStateFragments.values()) {
            state.remove(opHeaderHash);
        }

        this.requestedOps.remove(opHeaderHash);
        this.requestsForOp.deleteKey(opHash);

        for (const opHistory of this.discoveredHistory.getAllOpHeadersForOp(opHash)) {
            this.requestedOps.remove(opHistory.headerHash);
        }

        this.discoveredHistory.remove(opHeaderHash);

        // in case we were trying to fetch history for this op
        this.markOpHeaderAsFetched(opHeaderHash);

        for (const requestId of this.requestsBlockedByOpHeader.get(opHeaderHash)) {
            const reqInfo = this.requests.get(requestId);

            if (reqInfo !== undefined) {
                this.opXferLog.debug('\n'+this.logPrefix+'\nAttempting to process blocked request ' + requestId);
                reqInfo.missingCurrentState?.delete(opHeaderHash);
                this.attemptToProcessResponse(reqInfo); // not awaiting this
            } else {
                this.opXferLog.debug('\n'+this.logPrefix+'\nNot attempting to process blocked request ' + requestId + ': it is no longer there.');
            }
        }

        this.requestsBlockedByOpHeader.deleteKey(opHeaderHash);
    }

    private markOpHeaderAsFetched(opHistoryHash: Hash) {
        this.requestsForOpHistory.deleteKey(opHistoryHash);
    }

    // TODO: identify peer as bad !
    private processBadOpHistory(opCausalHistory: OpHeader) {
        this.markOpAsFetched(opCausalHistory);
    }

    private computeStartingOpHistories() {
        return new Set<Hash>(this.localStateFragment.contents.keys());//this.terminalOpHistoriesPlusCurrentState(this.discoveredHistory);
    }

    private async computeStartingOps(remoteHistory: HistoryFragment) : Promise<Set<Hash>>{

        // find the missingPrevOpHeaders of the unrequested fragment of remoteHistory
        // TODO: take into account which ops we want to actually request, and add the
        //       ops in missingPrevOpHeaders necessary just for those

        const unrequestedFragmentForRemote = remoteHistory.clone();

        for (const opHeader of this.requestedOps.contents.values()) {
            unrequestedFragmentForRemote.remove(opHeader.headerHash);
        }

        // TODO: make this method return an array, so we can give more priority to the
        //       ops in missingPrevOpHeaders than to the ones added next

        const start = new Set<Hash>();

        for (const opHeaderHash of unrequestedFragmentForRemote.missingPrevOpHeaders) {
            if (this.requestedOps.contents.has(opHeaderHash) || 
                (await this.syncAgent.store.loadOpHeaderByHeaderHash(opHeaderHash)) !== undefined) {
                
                start.add(opHeaderHash);
            }
        }

        // To enable speculative addition of ops to the reply, we add our current state too.

        if (this.syncAgent.state?.terminalOpHeaderHashes !== undefined) {
            for (const opHeaderHash of this.syncAgent.state?.terminalOpHeaderHashes.values()) {
                start.add(opHeaderHash)
            }
        }

        //for (const opHeader of this.localStateFragment.contents.values()) {
        //    start.add(opHeader.headerHash);
        //}

        return start;
        /*
        const requestedFragmentForRemote = new HistoryFragment(remoteHistory.mutableObj);

        for (const opHeader of this.localState.contents.values()) {
            requestedFragmentForRemote.add(opHeader);
        }

        for (const opHeader of this.requestedOps.contents.values()) {
            if (remoteHistory.contents.has(opHeader.headerHash)) {
                requestedFragmentForRemote.add(opHeader);
            }
        }

        return new Set<Hash>(requestedFragmentForRemote.terminalOpHeaders);
        */
    }

    private opHistoryIsUndiscovered(opHistory: Hash): boolean {
        return !this.discoveredHistory.contents.has(opHistory);
    }

    private opHistoryIsUnrequested(opHistory: Hash): boolean {
        return  this.requestsForOpHistory.get(opHistory).size === 0;
    }

    private async opHistoryIsMissingFromStore(opHistory: Hash): Promise<Boolean> {
        return await this.syncAgent.store.loadOpHeaderByHeaderHash(opHistory) === undefined;
    }

    private async validateResponse(remote: Endpoint, msg: ResponseMsg): Promise<boolean> {

        const reqInfo = this.requests.get(msg.requestId);

        // if request is known and was sent to 'remote' and unreplied as of now:
        if (reqInfo !== undefined && reqInfo.remote === remote && reqInfo.response === undefined) {

            reqInfo.status = 'validating';
            reqInfo.response = msg;

            const req   = reqInfo.request;
            const resp = reqInfo.response;

            let receivedHistory: HistoryFragment | undefined = undefined;

            // Make sets out of these arrays for easy membership check:
            const requestedOpHistories = new Set<Hash>(req.requestedTerminalOpHistory);
            //const informedAsFetchedOpHistories = new Set<Hash>(req.terminalFetchedOpHistories);
            const requestedOps = new Set<Hash>(req.requestedOps);

            // Validate received history

            if (resp.history !== undefined) {
                receivedHistory = new HistoryFragment(this.syncAgent.mutableObjHash);

                // Verify all received op history literals and create a fragment from 'em:
                for (const opHistoryLiteral of resp.history) {
                    try {
                        receivedHistory.add(new OpHeader(opHistoryLiteral));
                    } catch (e) {
                        const detail = 'Error parsing op history literal ' + opHistoryLiteral.headerHash + ' received from ' + reqInfo.remote + ', cancelling request ' + reqInfo.request.requestId;
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
                for (const opHistoryHash of receivedHistory.terminalOpHeaders) {
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
                    const storedOpHistory = await this.syncAgent.store.loadOpHeader(opHistory.opHash);

                    if (storedOpHistory !== undefined) {
                        if (storedOpHistory.headerHash !== opHistory.headerHash) {
                            const detail = 'Received history for op ' + opHistory.opHash + ' has causal hash of ' + opHistory.headerHash + ', but it does not match the already stored causal hash of ' + storedOpHistory.headerHash + ', discarding response for ' + req.requestId;
                            this.cancelRequest(reqInfo, 'invalid-response', detail);
                            return false;
                        }
                    }
                }
             }

            // Validate response's sendingOps
            
            // The reply MAY contain ops we didn't request, if they directly follow our stated current state.
            // Make a history fragment using this additional ops to check that is indeed the case.
            const additionalOpsHistory = new HistoryFragment(this.syncAgent.mutableObjHash);

            if (resp.sendingOps !== undefined) {
                for (const hash of resp.sendingOps) {
                    if (!requestedOps.has(hash)) {
                        const opHistory = receivedHistory?.getOpHeaderForOp(hash);
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
                        for (const opHistoryHash of additionalOpsHistory.missingPrevOpHeaders) {
                            if (await this.syncAgent.store.loadOpHeaderByHeaderHash(opHistoryHash) === undefined) {
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
        reqInfo.requestSendingTimestamp = Date.now();

        const reqId = reqInfo.request.requestId;
        this.requests.set(reqId, reqInfo);
        this.activeRequests.add(reqInfo.remote, reqId);
        
        if (reqInfo.request?.requestedOps !== undefined) {
            for (const hash of reqInfo.request?.requestedOps) {
                this.requestsForOp.add(hash, reqId);
                for (const opHistory of this.discoveredHistory.getAllOpHeadersForOp(hash)) {
                    this.requestedOps.add(opHistory);
                }
            }
        }

        if (reqInfo.request.requestedTerminalOpHistory !== undefined) {
            for (const opHistoryHash of reqInfo.request.requestedTerminalOpHistory) {
                this.requestsForOpHistory.add(opHistoryHash, reqId)
            }
        }

        let sent = this.syncAgent.sendMessageToPeer(reqInfo.remote, this.syncAgent.getAgentId(), reqInfo.request);

        if (sent) {
            this.requestLog.debug('Sent req ' + reqInfo.request.requestId + ' (' + reqInfo.request.requestedOps?.length + ' ops) to ' + reqInfo.remote);
        } else {
            this.requestLog.debug('Sent FAILURE for req ' + reqInfo.request.requestId + ' (' + reqInfo.request.requestedOps?.length + ' ops)');
        }

        return sent;
    }

    private cancelRequest(reqInfo: RequestInfo, reason: 'invalid-response'|'invalid-literal'|'out-of-order-literal'|'invalid-omitted-objs'|'slow-connection'|'other', detail: string) {

        if (this.lastCancelledRequests.indexOf(reqInfo.request.requestId) < 0) {
            if (this.lastCancelledRequests.length >= MaxSavedCancelledRequests) {
                this.lastCancelledRequests.shift();
            }

            this.lastCancelledRequests.push(reqInfo.request.requestId);
        }

        HeaderBasedSyncAgent.controlLog.debug('\n'+this.logPrefix+'\n'+detail);
        
        this.cleanupRequest(reqInfo);

        const msg: CancelRequestMsg = {
            type: MessageType.CancelRequest,
            requestId: reqInfo.request.requestId,
            reason: reason,
            detail: detail
        }
        
        this.requestLog.debug('Cancelling request ' + reqInfo.request.requestId);

        this.syncAgent.sendMessageToPeer(reqInfo.remote, this.syncAgent.getAgentId(), msg);
    }

    private checkRequestRemoval(reqInfo: RequestInfo) {

        if (reqInfo.response === undefined && reqInfo.requestSendingTimestamp !== undefined &&
            Date.now() > reqInfo.requestSendingTimestamp + RequestTimeout * 1000) {

            // Remove due to timeout waiting for response.

            this.cancelRequest(reqInfo, 'slow-connection', 'Timeout waiting for response');
            return true;

        } else if (reqInfo.response !== undefined && reqInfo.status !== 'validating') { // ??? requests are vanishing during validation
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
                this.requestsBlockedByOpHeader.delete(hash, requestId);
            }
        }

        if (reqInfo.request.requestedOps !== undefined) {

            // Remove the op requests

            for (const opHash of reqInfo.request?.requestedOps) {
                this.requestsForOp.delete(opHash, requestId);

                if (this.requestsForOp.get(opHash).size === 0) {
                    for (const opHistory of this.discoveredHistory.getAllOpHeadersForOp(opHash)) {
                        this.requestedOps.remove(opHistory.headerHash);
                    }
                }
            }
        }

        if (reqInfo.response?.sendingOps !== undefined) {

            // If the request has a response, then requestsForOp may have been
            // updated to expect what the response.sendingOps sepecifies, so remove
            // thes op requests

            for (const opHash of reqInfo.response?.sendingOps) {
                this.requestsForOp.delete(opHash, requestId);

                if (this.requestsForOp.get(opHash).size === 0) {
                    for (const opHistory of this.discoveredHistory.getAllOpHeadersForOp(opHash)) {
                        this.requestedOps.remove(opHistory.headerHash);
                    }
                }
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

        // see if we can shut down the timer checking for timeouts
        this.checkRequestTimeoutsTimer();

        this.requestLog.debug('Cleaned up request ' + reqInfo.request.requestId);

    }

    private async logStoreContents() {
        this.storeLog.debug('\n'+this.logPrefix+'\nStored state before request\n' + await this.syncAgent.lastStoredOpsDescription())            
    }

    selfDiagnostic(): string {

        let diag = '\ncurrent requests:\n';

        for (const [reqId, reqInfo] of this.requests.entries()) {

            diag = diag + '\n[' + reqId + '] to peer ' + reqInfo.remote + '\n';
            diag = diag + '\n    status:  ' + reqInfo.status;
            if (reqInfo.requestSendingTimestamp !== undefined) {
                diag = diag + '\n    sent:    ' + ((Date.now() - reqInfo.requestSendingTimestamp)/1000) + ' seconds ago';
            }
            if (reqInfo.responseArrivalTimestamp !== undefined) {
                diag = diag + '\n    replied: ' + ((Date.now() - reqInfo.responseArrivalTimestamp)/1000) + ' seconds ago';
            }
            diag = diag + '\n    req op history terminals: ' + reqInfo.request.requestedTerminalOpHistory
            diag = diag + '\n    requested ops: ' + reqInfo.request.requestedOps;
            diag = diag + '\n    response ops manifest: ' + reqInfo.response?.sendingOps;
            diag = diag + '\n    expected literals:' + reqInfo.response?.literalCount;
            diag = diag + '\n    received literal count: ' + reqInfo.receivedLiteralsCount;

            const blockedBy = new Array<string>();

            for (const [opHeaderHash, reqIds] of this.requestsBlockedByOpHeader.entries()) {
                if (reqIds.has(reqId)) {
                    blockedBy.push(this.discoveredHistory.contents.get(opHeaderHash)?.opHash || 'missing from disc');
                }
            }

            if (blockedBy.length > 0) {
                diag = diag + '\n    blocked by ops: ' + blockedBy;
            }
            diag = diag + '\n';
        }

        return diag;

    }

    shutdown() {
        this.terminated = true;
        if (this.checkRequestTimeoutsInterval !== undefined) {
            clearInterval(this.checkRequestTimeoutsInterval);
            this.checkRequestTimeoutsInterval = undefined;
        }
    }

}

export { HistorySynchronizer };