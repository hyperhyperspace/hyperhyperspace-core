
import { HashedObject, HashedSet, Hash } from 'data/model';
import { MutationOp } from 'data/model';
import { Context, Literal, LiteralContext, Dependency } from 'data/model';

import { Store } from 'storage/store';

import { AgentPod } from '../../service/AgentPod';
import { Endpoint } from '../network/NetworkAgent';

import { GossipEventTypes, AgentStateUpdateEvent } from './StateGossipAgent';
import { StateSyncAgent } from './StateSyncAgent';
import { TerminalOpsState } from './TerminalOpsState';
import { Logger, LogLevel } from 'util/logging';
import { PeeringAgentBase } from '../peer/PeeringAgentBase';
import { PeerGroupAgent } from '../peer/PeerGroupAgent';
import { RNGImpl } from 'crypto/random';
import { MultiMap } from 'util/multimap';

/*

*Introduction*

The TerminalOpsSyncAgent's purpose is to synchronize the state of a MutableObject by keeping track
of its "terminal ops". A MutableObject represents the initial state of the object, which is then
updated by creating MutationOp instances that point to it through their "target" field.

The agent will be instantiated to sync a particular MutableObject present in the local store, and
will perform state reconcilaition with any connected peers that either advertise new states
through gossiping or request MutationOps in response to its own state advertisements.

The TerminalOpsSyncAgent only deals with actual state sync. The gossiping of new states is done
by other agents (typically the StateGossipAgent, which batches together the states of all the
objects that a peer wants to sync with a particular PeerGroup). The local TerminalOpsSyncAgent and 
StateGossipAgent communicate trough the local broadcasting mechanism of the AgentPod they share.


*State by terminal ops*

The TerminalOpsSyncAgent uses the "prevOps" field in the MutationOp object to discard all the ops
that have any following ops -that is another op that points to them through its "prevOps" field- 
and use the set of remaining "terminal ops" as a way to represent the state of the MutableObject 
being synchronized. This set of terminal ops can be obtained easily and quickly from the store 
itself.

*State broadcasting*

After discovering that the state of the object has changed, the agent will broadcast a message to
the local agent pod informing of the update. Any gossiping agents active in the pod will pick up
the update and inform any connected peers. Conversely, if any gossip agent picks up any state update
from a connected peer, it will also broadcast a message on the local agent pod. The 
TermninalOpsSyncAgent will check the received state and start synchronizing with such a peer if
necessary.

*State sync*

After determining (via gossip results broadcaste on the local pod by a gossiping agent) that it
needs to perform state sync, the TerminalOpsSyncAgent exchanges a series of messages with the
TerminalOpsSyncAgent on the peer that has advertised a new state. Since the state is just the
set of "terminal ops" on the other end, the agent will just ask for any of this "terminal ops"
that are missing on the local store. Since an op can only be persisted to the store once all
its prevOps have been already persisted, the agent may need to make several calls until it can
reconcile the local state with the remote one, following the trail of prevOps until all the
dependencies of the terminalOps have been fetched. There are 4 types of messages used in this
task:

The SendStateMessage is sent in reply to a RequestStateMessage, and it will send the set of
terminalOps in full (gossiping usually would send just a hash of the terminalOp set).

The SendOpsMessage is sent in reply to the RequestObjsMessage, and will send the literalized
version of the objects and their dependencies.

*Security measures, optimizations*

When sending state (in the form of literalized objects) the agent may omit some dependencies
of the objects being sent, expecting the receiving peer to already have them in its store
(e.g., the identities and public keys that are referenced again and again by the ops being
applied to the target object). And of course, there may be more prevOps that the other end
discovers as a result of the received objects, and that it also needs to request.

There are two security measures in place to prevent object exfiltration:

Rule 1. Every requested object needs to be referenced (probably indirectly) from an op that has the
object being synchronized as its target.
Rule 2. Every an object A that is sent, and has a reference B that is optimized away from the sent
message, must provide also a proof that the sender has B locally in its store.

The purpose of Rule 1 is preventing an adversary from requesting arbitrary objects that have no
relation to the object being synchronized.

The purpose of Rule 2 is a bit more subtle: an adversary may construct a legitimate MutationOp that
he then applies to the object being syncronized in such a way that the op references some object
that he wants to steal from another peer (perhaps an object
unrelated to the one being synchronized). So even if the attacker knows the hash of the object that
he wants to steal, and is able to construct a MutationOp that will be accepted by the type of the
mutations that the mutable object accepts, he will not be able to provide the proof of ownership
that is required for sending incomplete operations.


*/

enum TerminalOpsSyncAgentMessageType {
    RequestState     = 'request-state',
    SendState        = 'send-state',
    RequestObjs      = 'request-objs',
    SendObjs         = 'send-objs'
};


type RequestStateMessage = {
    type          : TerminalOpsSyncAgentMessageType.RequestState,
    targetObjHash : Hash
}

type SendStateMessage = {
    type          : TerminalOpsSyncAgentMessageType.SendState,
    targetObjHash : Hash,
    state         : any
}

type RequestObjsMessage = {
    type                 : TerminalOpsSyncAgentMessageType.RequestObjs,
    targetObjHash        : Hash,
    requestedObjects     : Array<ObjectRequest>,
    ownershipProofSecret : string
}

type SendObjsMessage = {
    type                  : TerminalOpsSyncAgentMessageType.SendObjs,
    targetObjHash         : Hash,
    sentObjects           : LiteralContext,
    ownershipProofSecret? : string,
    omittedDeps           : Array<OwnershipProof>
}

type TerminalOpsSyncAgentMessage = RequestStateMessage | RequestObjsMessage | 
                                  SendStateMessage |    SendObjsMessage ;

type TerminalOpsSyncAgentParams = {
    sendTimeout    : number,
    receiveTimeout : number,
    incompleteOpTimeout: number
};

type ObjectMovements = Map<Hash, Map<Endpoint, {secret: string, timeout: number, dependencyChain: Array<Hash>}>>;
type ObjectRequest   = { hash: string, dependencyChain: Array<string> };
type OwnershipProof  = { hash: Hash, ownershipProofHash: Hash };
 
type IncompleteOp = { source: Endpoint, context: Context, missingObjects: Map<Hash, ObjectRequest>, timeout: number };

class TerminalOpsSyncAgent extends PeeringAgentBase implements StateSyncAgent {

    static controlLog     = new Logger(TerminalOpsSyncAgent.name, LogLevel.INFO);
    static peerMessageLog = new Logger(TerminalOpsSyncAgent.name, LogLevel.INFO);
    static opTransferLog  = new Logger(TerminalOpsSyncAgent.name, LogLevel.INFO);

    static syncAgentIdFor(objHash: Hash, peerGroupId: string) {
        return 'terminal-ops-for-' + objHash + '-in-peer-group-' + peerGroupId;
    }

    params: TerminalOpsSyncAgentParams;

    objHash: Hash;
    acceptedMutationOpClasses: Array<String>;

    pod?: AgentPod;
    store: Store;

    state?: TerminalOpsState;
    stateHash?: Hash;

    opCallback: (opHash: Hash) => Promise<void>;

    outgoingObjects : ObjectMovements;
    incomingObjects : ObjectMovements;
    
    incompleteOps    : Map<Hash, IncompleteOp>;
    opsForMissingObj : MultiMap<Hash, Hash>; // <-- a reverse index to find, given an object 
                                             //     that has just been received,
                                             //     which incmplete ops depend on it.

    opShippingInterval: any;

    controlLog     = TerminalOpsSyncAgent.controlLog;
    peerMessageLog = TerminalOpsSyncAgent.peerMessageLog;
    opTransferLog  = TerminalOpsSyncAgent.opTransferLog;

    constructor(peerGroupAgent: PeerGroupAgent, objectHash: Hash, store: Store, acceptedMutationOpClasses : Array<string>, params?: TerminalOpsSyncAgentParams) {
        super(peerGroupAgent);

        if (params === undefined) {
            params = {
                sendTimeout: 60,
                receiveTimeout: 90,
                incompleteOpTimeout: 3600
            };
        }

        this.params = params;

        this.objHash = objectHash;
        this.store = store;
        this.acceptedMutationOpClasses = acceptedMutationOpClasses;

        this.opCallback = async (opHash: Hash) => {

            this.opTransferLog.debug('Op ' + opHash + ' found for object ' + this.objHash + ' in peer ' + this.peerGroupAgent.getLocalPeer().endpoint);

            let op = await this.store.load(opHash) as MutationOp;
            if (this.shouldAcceptMutationOp(op)) {
                await this.loadStoredState();  
            }
        };

        this.outgoingObjects = new Map();
        this.incomingObjects = new Map();

        this.incompleteOps = new Map();
        this.opsForMissingObj = new MultiMap();

        this.opShippingInterval = setInterval(() => {
            let now = Date.now();
            
            // check sending / receiving timeouts & remove stale entries

            let allOutdatedObjectHashes = new Array<Array<Hash>>();

            for (const objs of [this.outgoingObjects, this.incomingObjects]) {

                let outdated: Array<Hash> = [];

                for (const [hash, destinations] of objs.entries()) {

                    let outdatedEndpoints: Array<Hash> = []
    
                    for (const [endpoint, params] of destinations.entries()) {
                        if (now > params.timeout) {
                            outdatedEndpoints.push(endpoint);
                        }
                    }
    
                    for (const ep of outdatedEndpoints) {
                        destinations.delete(ep);
                    }
    
                    if (destinations.size === 0) {
                        outdated.push(hash);
                    }
                }

                for (const hash of outdated) {
                    objs.delete(hash);
                }

                allOutdatedObjectHashes.push(outdated);
    
            }

            // FIXME: schedule a retry (maybe from another peer?) when fetching fails

            for (const hash of allOutdatedObjectHashes[1]) {

                // do something with

                this.controlLog.warning('fetching of object with hash ' + hash + ' has timed out');
            }

            let timeoutedIncompleteOps = new Array<Hash>();

            for (const [hash, incompleteOp] of this.incompleteOps.entries()) {

                if (incompleteOp.timeout > now) {
                    for (const depHash of incompleteOp.missingObjects.keys()) {
                        this.opsForMissingObj.delete(depHash, hash);
                    }

                    timeoutedIncompleteOps.push(hash);
                }

            }

            for (const hash of timeoutedIncompleteOps) {
                this.incompleteOps.delete(hash);
            }
            

        }, 5000);

    }

    getAgentId(): string {
        return TerminalOpsSyncAgent.syncAgentIdFor(this.objHash, this.peerGroupAgent.peerGroupId);
    }

    ready(pod: AgentPod): void {
        
        this.controlLog.debug(
              'Starting for object ' + this.objHash + 
              ' on ep ' + this.peerGroupAgent.getLocalPeer().endpoint + 
              ' (topic: ' + this.peerGroupAgent.getTopic() + ')');
        
        this.pod = pod;
        this.loadStoredState();
        this.watchStoreForOps();
    }

    async receiveRemoteState(sender: Endpoint, stateHash: Hash, state?: HashedObject | undefined): Promise<boolean> {
        
        if (state !== undefined) {
            let computedHash = state.hash();

            if (computedHash !== stateHash) {
                // TODO: report bad peer
                return false;
            } else {

                let peerTerminalOpsState = state as TerminalOpsState;
                
                this.opTransferLog.debug(this.getPeerControl().getLocalPeer().endpoint + ' received terminal op list from ' + sender + ': ' + Array.from(peerTerminalOpsState.terminalOps?.values() as IterableIterator<string>));

                let opsToFetch: Hash[] = [];

                let badOps = false;

                for (const opHash of (peerTerminalOpsState.terminalOps as HashedSet<Hash>).values()) {
                    let o = await this.store.load(opHash);

                    if (o === undefined) {
                        opsToFetch.push(opHash);
                    } else {
                        const op = o as MutationOp;

                        if (!this.shouldAcceptMutationOp(op)) {
                            badOps = true;
                        }
                    }
                }

                if (badOps) {
                    // report bad peer
                } else if (opsToFetch.length > 0) {
                    this.sendRequestObjsMessage(sender, opsToFetch.map( (hash: Hash) => ({hash: hash, dependencyChain: []}) ));
                }

                return opsToFetch.length > 0 && !badOps;
            }
        } else {
            if (stateHash !== this.stateHash) {
                this.sendRequestStateMessage(sender);
            }
            return false;
        }
        
    }

    receivePeerMessage(source: Endpoint, sender: Hash, recipient: Hash, content: any): void {

        sender; recipient;

        let msg: TerminalOpsSyncAgentMessage = content as TerminalOpsSyncAgentMessage;
        
        if (msg.targetObjHash !== this.objHash) {

            // TODO: report bad peer go peer group?

            this.peerMessageLog.warning('Received wrong targetObjHash, expected ' + this.objHash + ' but got ' + msg.targetObjHash + ' from ' + source);

            return;
        }

        this.peerMessageLog.debug('terminal-ops-agent: ' + this.getPeerControl().getLocalPeer().endpoint + ' received ' + msg.type + ' from ' + source);

        if (msg.targetObjHash === this.objHash) {
            if (msg.type === TerminalOpsSyncAgentMessageType.RequestState) {
                this.sendState(source);
            } else if (msg.type === TerminalOpsSyncAgentMessageType.RequestObjs) {
                this.sendOrScheduleObjects(source, msg.requestedObjects, msg.ownershipProofSecret);
            } else if (msg.type === TerminalOpsSyncAgentMessageType.SendState) {
                const sendStateMsg = msg as SendStateMessage;
                let state = HashedObject.fromLiteral(sendStateMsg.state);
                this.receiveRemoteState(source, state.hash(), state);
            } else if (msg.type === TerminalOpsSyncAgentMessageType.SendObjs) {
                // TODO: you need to check signatures here also, so FIXME
                //       (signatures will be checked when importing object, but it would be wise
                //       to check if each dependency has valid signatures even before the object
                //       is complete)
                const sendOpsMsg = msg as SendObjsMessage;
                this.receiveObjects(source, sendOpsMsg.sentObjects, sendOpsMsg.omittedDeps, sendOpsMsg.ownershipProofSecret);
            }
        }

    }

    watchStoreForOps() {
        this.store.watchReferences('target', this.objHash, this.opCallback);
    }

    unwatchStoreForOps() {
        this.store.removeReferencesWatch('target', this.objHash, this.opCallback);
    }

    getObjectHash(): string {
        return this.objHash;
    }

    shutdown() {
        this.unwatchStoreForOps();
        if (this.opShippingInterval !== undefined) {
            clearInterval(this.opShippingInterval);
        } 
    }

    private async loadStoredState() : Promise<void> {
        const state = await this.getStoredState();
        const stateHash = state.hash();

        if (this.stateHash === undefined || this.stateHash !== stateHash) {
            this.controlLog.debug('Found new state ' + stateHash + ' for ' + this.objHash + ' in ' + this.peerGroupAgent.getLocalPeer().endpoint);
            this.state = state;
            this.stateHash = stateHash;
            let stateUpdate: AgentStateUpdateEvent = {
                type: GossipEventTypes.AgentStateUpdate,
                content: { agentId: this.getAgentId(), state }
            }
            this.pod?.broadcastEvent(stateUpdate);
        }

    }

    private async getStoredState(): Promise<HashedObject> {
        let terminalOpsInfo = await this.store.loadTerminalOpsForMutable(this.objHash);

        if (terminalOpsInfo === undefined) {
            terminalOpsInfo = {terminalOps: []};
        }

        return TerminalOpsState.create(this.objHash, terminalOpsInfo.terminalOps);
    }

    private sendRequestStateMessage(destination: Endpoint) {
        let msg: RequestStateMessage = {
            type: TerminalOpsSyncAgentMessageType.RequestState,
            targetObjHash: this.objHash
        };

        this.sendSyncMessageToPeer(destination, msg);
    }

    private sendRequestObjsMessage(destination: Endpoint, reqs: Array<ObjectRequest>) {

        let secret = new RNGImpl().randomHexString(128);

        for (const req of reqs) {
            this.expectIncomingObject(destination, req.hash, req.dependencyChain, secret);
        }

        let msg: RequestObjsMessage = {
            type: TerminalOpsSyncAgentMessageType.RequestObjs,
            targetObjHash: this.objHash,
            requestedObjects: reqs,
            ownershipProofSecret: secret
        };

        this.sendSyncMessageToPeer(destination, msg);
    }

    sendState(ep: Endpoint) {

        if (this.state !== undefined) {
            let msg: SendStateMessage = {
                type: TerminalOpsSyncAgentMessageType.SendState,
                targetObjHash: this.objHash,
                state: this.state?.toLiteral()
            };
    
            this.sendSyncMessageToPeer(ep, msg);
        }
    }

    private async sendOrScheduleObjects(destination: Endpoint, requestedObjects: Array<ObjectRequest>, secret: string) {

        let missing = await this.tryToSendObjects(destination, requestedObjects, secret);

        for (const req of missing) {
            this.scheduleOutgoingObject(destination, req.hash, req.dependencyChain, secret);
        }
        
    }

    // try to send the requested objects, return the ones that were not found.

    private async tryToSendObjects(destination: Endpoint, requestedObjects: Array<ObjectRequest>, secret: string) : Promise<Array<ObjectRequest>> {
        
        let provenReferences = new Set<Hash>();
        let ownershipProofs = new Array<OwnershipProof>();
        let sendLater = new Array<ObjectRequest>();

        let context = new Context();

        for (const req of requestedObjects) {

            let opHash = req.hash;
            let valid = true;
            let missing = false;

            // follow depedency path, until we reach the op
            for (const depHash of req.dependencyChain) {
                let depLiteral = await this.store.loadLiteral(depHash);

                if (depLiteral === undefined) {
                    missing = true;
                    break;
                } else {
                    const matches = depLiteral.dependencies.filter((dep: Dependency) => (dep.hash === opHash));
                    if (matches.length > 0) {
                        opHash = depHash;
                    } else {
                        valid = false;
                        break;
                    }
                }
            }

            // if we found all intermediate objects, check if the op is valid
            if (!missing && valid) {
                let op = await this.store.load(opHash);

                if (op === undefined) {
                    missing = true;
                } else if (!this.shouldAcceptMutationOp(op as MutationOp)) {
                    valid = false;
                }
            }

            // if we found the op and it is valid, fetch the requested object
            if (valid && !missing) {
                let obj = await this.store.load(req.hash);
                if (obj === undefined) {
                    missing = true;
                } else {
                    obj.toContext(context);
                    const hash = context.rootHashes[context.rootHashes.length-1];
                    
                    for (const dep of (context.literals.get(hash) as Literal).dependencies) {
                        if (dep.type === 'reference') {
                            if (!provenReferences.has(dep.hash)) {
                                let ref = await this.store.load(dep.hash) as HashedObject;
                                ownershipProofs.push({hash: dep.hash, ownershipProofHash: ref.hash(secret)});
                                provenReferences.add(dep.hash);
                            }
                        }
                    } 
                }
            }

            // if everything is consistent but we don't have it, mark to schedule
            if (valid && missing) {
                sendLater.push(req);
            }

        }

        if (context.rootHashes.length > 0) {
            let msg: SendObjsMessage = {
                type: TerminalOpsSyncAgentMessageType.SendObjs,
                targetObjHash: this.objHash,
                sentObjects: context.toLiteralContext(),
                omittedDeps: ownershipProofs,
                ownershipProofSecret: secret
            }

            this.sendSyncMessageToPeer(destination, msg);
        }

        return sendLater;
    }

    private async processReceivedObject(hash: Hash, context: Context) {
        let obj = HashedObject.fromContext(context, hash, true);

        if (this.shouldAcceptMutationOp(obj as MutationOp)) {
            this.controlLog.trace(() => 'saving object with hash ' + hash + ' in ' + this.peerGroupAgent.localPeer.endpoint);
            await this.store.save(obj);
        } else {
            this.controlLog.warning(() => 'NOT saving object with hash ' + hash + ' in ' + this.peerGroupAgent.localPeer.endpoint + ', it has the wrong type for a mutation op.');
        }

        let destinations = this.outgoingObjects.get(hash);

        if (destinations !== undefined) {
            for (const [endpoint, details] of destinations.entries()) {
                this.tryToSendObjects(endpoint, [{hash: hash, dependencyChain: details.dependencyChain}], details.secret);
            }
        }

        for (const opHash of this.opsForMissingObj.get(hash)) {

            const incompleteOp = this.incompleteOps.get(opHash) as IncompleteOp;

            incompleteOp.context.objects.set(hash, obj);
            incompleteOp.missingObjects.delete(hash);

            if (incompleteOp.missingObjects.size === 0) {

                try {
                    this.processReceivedObject(opHash, context);
                // TODO: catch error, log, report bad peer?
                } catch(e) { 
                    this.controlLog.warning('could not process received object with hash ' + hash + ', error is: ' + e);
                } finally {
                    this.incompleteOps.delete(opHash);
                    
                }
            }
        }

        // just in case this op was received partailly before:
        this.incompleteOps.delete(hash);
    }

    private async receiveObjects(source: Endpoint, literalContext: LiteralContext, omittedDeps: Array<OwnershipProof>, secret?: string) {
        
        let context = new Context();
        context.fromLiteralContext(literalContext);

        let ownershipProofForHash = new Map<Hash, Hash>();

        for (const omittedDep of omittedDeps) {
            ownershipProofForHash.set(omittedDep.hash, omittedDep.ownershipProofHash);
        }

        if (context.checkRootHashes() && context.checkLiteralHashes()) {

            for (const hash of context.rootHashes) {

                this.controlLog.trace(() => 'processing incoming object with hash ' + hash);
                
                const incoming = this.incomingObjects.get(hash)?.get(source);

                if (incoming !== undefined && incoming.secret === secret) {

                    try {
                        let toRequest = Array<ObjectRequest>();
                        
                        for (let [depHash, depChain] of context.findMissingDeps(hash).entries()) {
                            let dep = await this.store.load(depHash);
                            if (dep === undefined || dep.hash(secret) !== ownershipProofForHash.get(depHash)) {
                                if (dep !== undefined) {
                                    this.controlLog.trace('missing valid ownership proof for ' + hash);
                                    // TODO: log / report invalid ownership proof
                                }
                                toRequest.push({hash: depHash, dependencyChain: depChain});
                            } else {
                                context.objects.set(depHash, dep);
                            }
                        }
                        
                        if (toRequest.length === 0) {
                            this.controlLog.trace('received object with hash ' + hash + ' is complete, about to process');
                            this.processReceivedObject(hash, context);
                        } else {
                            
                            // If this claims to be an op that should be prcesed later, record an incomplete op
                            if (this.shouldAcceptMutationOpLiteral(context.literals.get(hash) as Literal)) {
                                this.controlLog.trace('received object with hash ' + hash + ' is incomplete, about to process');
                                this.processIncompleteOp(source, hash, context, toRequest);
                            } else {
                                this.controlLog.warning('received object with hash ' + hash + ' has the wrong type for a mutation op, ignoring');
                            }

                            this.sendRequestObjsMessage(source, toRequest);
                        }

                    } catch (e) {
                        TerminalOpsSyncAgent.controlLog.warning(e);
                    }
                    this.incomingObjects.delete(hash);
                } else {
                    
                    // TODO: report missing or incorrect incoming object entry
                    if (incoming === undefined) {
                        this.controlLog.warning('missing incoming object entry for hash ' + hash + ' in object sent by ' + source);
                    } else {
                        this.controlLog.warning('incoming object secret mismatch, expected: ' + secret + ', received: ' + incoming.secret);
                    }
                    
                }
            }
        } else {
            // TODO: report invalid context somewhere
            this.controlLog.warning('received invalid context from ' + source + ' with rootHashes ' + context?.rootHashes)
            
        }
    }

    private async processIncompleteOp(source: Endpoint, hash: Hash, context: Context, toRequest: Array<ObjectRequest>) {

        let incompleteOp = this.incompleteOps.get(source);
        let missingObjects = new Map<Hash, ObjectRequest>( toRequest.map((req: ObjectRequest) => [req.hash, req]) );

        if (incompleteOp === undefined) {
            incompleteOp = {
                source: source,
                context: context,
                missingObjects: missingObjects,
                timeout: Date.now() + this.params.incompleteOpTimeout * 1000
            };
            this.incompleteOps.set(hash, incompleteOp);
        } else {

            const initialMissingCount = incompleteOp.missingObjects.size;

            incompleteOp.context.merge(context);
            let found = new Array<Hash>();
            for (const missingHash of incompleteOp.missingObjects.keys()) {
                if (incompleteOp.context.has(missingHash)) {
                    found.push(missingHash);
                }
            }
            for (const foundHash of found) {
                incompleteOp.missingObjects.delete(foundHash);
                this.opsForMissingObj.delete(foundHash, hash);
            }

            if (incompleteOp.missingObjects.size === 0) {
                try {
                    this.processReceivedObject(hash, context);
                } finally {
                    this.incompleteOps.delete(hash);
                }
            } else if (incompleteOp.missingObjects.size < initialMissingCount) {
                incompleteOp.timeout = Date.now() + this.params.incompleteOpTimeout * 1000;
            }
        }

    }

    sendSyncMessageToPeer(destination: Endpoint, msg: TerminalOpsSyncAgentMessage) {
        this.sendMessageToPeer(destination, this.getAgentId(), msg);
    }

    private shouldAcceptMutationOp(op: MutationOp): boolean {

        return this.objHash === op.target?.hash() &&
               this.acceptedMutationOpClasses.indexOf(op.getClassName()) >= 0;
    }

    private shouldAcceptMutationOpLiteral(op: Literal): boolean {
        return this.objHash === op.value._fields['target']._hash &&
               this.acceptedMutationOpClasses.indexOf(op.value._class) >= 0;
    }

    private expectIncomingObject(source: Endpoint, objHash: Hash, dependencyChain: Array<Hash>, secret: string) {
        this.insertObjectMovement(this.incomingObjects, source, objHash, dependencyChain, secret, this.params.receiveTimeout);
    }

    private scheduleOutgoingObject(destination: Endpoint, objHash: Hash, dependencyChain: Array<Hash>, secret: string) {
        this.insertObjectMovement(this.outgoingObjects, destination, objHash, dependencyChain, secret, this.params.sendTimeout);
    }

    private insertObjectMovement(allMovements: ObjectMovements, endpoint: Endpoint, objHash: Hash, dependencyChain: Array<Hash>, secret: string, timeout: number) {

        let movement = allMovements.get(objHash);

        if (movement === undefined) {
            movement = new Map();
            allMovements.set(objHash, movement);
        }

        movement.set(endpoint, {dependencyChain: dependencyChain, secret: secret, timeout: Date.now() + timeout * 1000});
    }
    
}

export { TerminalOpsSyncAgent };