import { ObjectDiscoveryPeerSource, PeerGroupAgentConfig, PeerInfo, PeerSource } from 'mesh/agents/peer';
import { CannotInferPeerGroup, Mesh, PeerGroupInfo, SyncMode, UsageToken } from 'mesh/service/Mesh';
import { MeshCommand,
    JoinPeerGroup, LeavePeerGroup,
    SyncObjectsWithPeerGroup, StopSyncObjectsWithPeerGroup,
    StartObjectBroadcast, StopObjectBroadcast,
    FindObjectByHash, FindObjectByHashSuffix, 
    CommandStreamedReply, LiteralObjectDiscoveryReply, DiscoveryEndReply,
    PeerSourceRequest, 
    Shutdown,
    PeerInfoContext,
    AddObjectSpawnCallback,
    SendObjectSpawnRequest,
    ForwardPeerGroupState,
    ForwardSyncState,
    AddSyncObserver,
    RemoveSyncObserver} from './MeshHost';

import { RNGImpl } from 'crypto/random';
import { Context, Hash, HashedObject, MutableObject } from 'data/model';
import { AsyncStream, BufferedAsyncStream, BufferingAsyncStreamSource } from 'util/streams';
import { ObjectDiscoveryReply } from 'mesh/agents/discovery';
import { Endpoint } from 'mesh/agents/network';
import { LinkupAddress, LinkupManager, LinkupManagerCommand, LinkupManagerProxy } from 'net/linkup';
import { WebRTCConnectionEvent, WebRTCConnectionsHost } from 'net/transport';
import { Identity } from 'data/identity';
import { ObjectSpawnAgent, SpawnCallback } from 'mesh/agents/spawn';
import { PeerGroupState } from 'mesh/agents/peer/PeerGroupState';
import { Resources } from 'spaces/Resources';
import { MeshInterface } from './MeshInterface';
import { SyncState, SyncObserver } from 'mesh/agents/state';

/* Access a mesh remotely, see the MeshHost class. */

type RequestId = string;
type ObserverId = string;

class MeshProxy implements MeshInterface {

    commandForwardingFn: (cmd: MeshCommand) => void;
    discoveryStreamSources: Map<string, BufferingAsyncStreamSource<ObjectDiscoveryReply>>;
    spawnCallbacks: Map<string, SpawnCallback>;
    commandStreamedReplyIngestFn: (reply: CommandStreamedReply) => void;

    linkup?: LinkupManagerProxy;
    webRTCConnsHost?: WebRTCConnectionsHost;

    peerSources: Map<string, PeerSource>;
    peerSourceRequestIngestFn: (req: PeerSourceRequest) => void;

    pendingPeerGroupStates: Map<RequestId, {resolve: (result: PeerGroupState|undefined) => void, reject: (reason: any) => void, timeout: any}>;
    pendingSyncStates: Map<RequestId, {resolve: (result: SyncState|undefined) => void, reject: (reason: any) => void, mut: MutableObject, timeout: any}>;
    

    syncObservers: Map<ObserverId, [SyncObserver, MutableObject]>;
    syncObserverIds: Map<SyncObserver, ObserverId>;

    pendingAddSyncObserver: Map<ObserverId, {resolve: () => void, reject: (reason: any) => void, timeout: any}>;
    pendingRemoveSyncObserver: Map<ObserverId, {resolve: () => void, reject: (reason: any) => void, timeout: any}>;

    constructor(meshCommandFwdFn: (cmd: MeshCommand) => void, linkupCommandFwdFn?: (cmd: LinkupManagerCommand) => void, webRTCConnEventIngestFn?: (ev: WebRTCConnectionEvent) => void) {
        this.commandForwardingFn = meshCommandFwdFn;
        this.discoveryStreamSources = new Map();
        this.spawnCallbacks = new Map();

        if (linkupCommandFwdFn !== undefined) {
            this.linkup = new LinkupManagerProxy(linkupCommandFwdFn);
        }

        if (webRTCConnEventIngestFn !== undefined) {
            this.webRTCConnsHost = new WebRTCConnectionsHost(webRTCConnEventIngestFn, this.linkup as any as LinkupManager); // ugly
        }

        this.commandStreamedReplyIngestFn = (reply: CommandStreamedReply) => {
            if (reply.type === 'object-discovery-reply') {
                const literalReply = reply as LiteralObjectDiscoveryReply;

                const objReply: ObjectDiscoveryReply = {
                    source: literalReply.source,
                    destination: literalReply.destination,
                    hash: literalReply.hash,
                    object: literalReply.objContext === undefined? undefined : HashedObject.fromLiteralContext(literalReply.objContext),
                    error: literalReply.error,
                    timestamp: literalReply.timestamp
                }

                this.discoveryStreamSources.get(literalReply.streamId)?.ingest(objReply);
            } else if (reply.type === 'object-discovery-end') {
                const endReply = reply as DiscoveryEndReply;
                this.discoveryStreamSources.get(endReply.streamId)?.end();
                this.discoveryStreamSources.delete(endReply.streamId)
            } else if (reply.type === 'object-spawn-callback') {
                const cb = this.spawnCallbacks.get(reply.callbackId);

                if (cb !== undefined) {
                    const object = HashedObject.fromLiteralContext(reply.object);
                    const sender = HashedObject.fromLiteralContext(reply.sender) as Identity;
                    cb(object, sender, reply.senderEndpoint);
                }
            } else if (reply.type === 'peer-group-state-reply') {
                const cb = this.pendingPeerGroupStates.get(reply.requestId)?.resolve;
                const to = this.pendingPeerGroupStates.get(reply.requestId)?.timeout;

                this.pendingPeerGroupStates.delete(reply.requestId);

                if (to !== undefined) {
                    window.clearTimeout(to);
                }

                if (cb !== undefined) {

                    if (reply.local !== undefined && reply.remote !== undefined) {
                        const remote = new Map<Endpoint, PeerInfo>();

                        const state: PeerGroupState = {
                            local: {endpoint: reply.local.endpoint, identityHash: reply.local.identityHash},
                            remote: remote
                        }
    
                        if (reply.local.identity !== undefined) {
                            state.local.identity = HashedObject.fromLiteralContext(reply.local.identity) as Identity;
                        }
    
                        for (const litPeerInfo of reply.remote) {

                            const peerInfo: PeerInfo = {endpoint: litPeerInfo.endpoint, identityHash: litPeerInfo.identityHash};

                            if (litPeerInfo.identity !== undefined) {
                                peerInfo.identity = HashedObject.fromLiteralContext(litPeerInfo.identity) as Identity;
                            }

                            remote.set(peerInfo.endpoint, peerInfo);
                        }

                        cb(state);    
                    } else {
                        cb(undefined);
                    }
                    
                }
            } else if (reply.type === 'sync-state-reply') {
                const pending = this.pendingSyncStates.get(reply.requestId);
                const cb = pending?.resolve;
                const err = pending?.reject;
                const to =  pending?.timeout;
                const mut = pending?.mut;

                this.pendingSyncStates.delete(reply.requestId);

                if (to !== undefined) {
                    window.clearTimeout(to);
                }

                if (reply.errorType === undefined && reply.error === undefined) {
                
                    if (cb !== undefined) {        
                        cb(reply.state);    
                    }
                } else {
                    if (err !== undefined) {
                        if (reply.errorType === 'infer-peer-group' && mut !== undefined) {
                            err(new CannotInferPeerGroup(mut.getLastHash()));
                        } else {
                            err(reply.error);
                        }
                    }
                }

            } else if (reply.type === 'add-sync-observer-reply') {
                const pending = this.pendingAddSyncObserver.get(reply.observerId);

                if (pending !== undefined) {
                    this.pendingAddSyncObserver.delete(reply.observerId);

                    if (pending.timeout !== undefined) {
                        window.clearTimeout(pending.timeout);
                    }

                    if (reply.error === undefined && reply.errorType === undefined) {
                        pending.resolve();
                    } else {
                        const pair = this.syncObservers.get(reply.observerId);
                        if (reply.errorType === 'infer-peer-group' && pair !== undefined) {
                            pending.reject(new CannotInferPeerGroup(pair[1].getLastHash()));        
                        } else {
                            pending.reject(reply.error);
                        }
                        this.syncObservers.delete(reply.observerId);
                        if (pair !== undefined) {
                            this.syncObserverIds.delete(pair[0]);
                        }
                    }
                }
            } else if (reply.type === 'remove-sync-observer-reply') {
                const pending = this.pendingRemoveSyncObserver.get(reply.observerId);

                if (pending !== undefined) {
                    this.pendingRemoveSyncObserver.delete(reply.observerId);

                    if (pending.timeout !== undefined) {
                        window.clearTimeout(pending.timeout);
                    }

                    const pair = this.syncObservers.get(reply.observerId);
                    if (reply.error === undefined && reply.errorType === undefined) {
                        this.syncObservers.delete(reply.observerId);
                        
                        if (pair !== undefined) {
                            this.syncObserverIds.delete(pair[0]);
                        }
                        pending.resolve();

                    } else {

                        if (reply.errorType === 'infer-peer-group' && pair !== undefined) {
                            pending.reject(new CannotInferPeerGroup(pair[1].getLastHash()));        
                        } else {
                            pending.reject(reply.error);
                        }
                    }
                }
            } else if (reply.type === 'sync-observer-event-reply') {

                const pair = this.syncObservers.get(reply.observerId);

                if (pair !== undefined) {
                    const [obs, mut] = pair;

                    obs({emitter: mut, action: reply.action, data: reply.data});
                }

            }
        }

        this.peerSources = new Map();
        this.peerSourceRequestIngestFn = (req: PeerSourceRequest) => {
            if (req.type === 'get-peers') {
                const source = this.peerSources.get(req.peerGroupId);

                if (source !== undefined) {
                    source.getPeers(req.count).then(
                        (value: PeerInfo[]) => {
                            this.commandForwardingFn({
                                type: 'forward-get-peers-reply',
                                requestId: req.requestId,
                                peers: value.map((pi: PeerInfo) => { return {endpoint: pi.endpoint, identityHash: pi.identityHash, identity: pi.identity?.getLastLiteralContext()}; }),
                                error: false
                        });
                        },
                        (_reason: any) => {
                            this.commandForwardingFn({
                                type: 'forward-get-peers-reply',
                                requestId: req.requestId,
                                peers: [],
                                error: true
                            });
                        });
                }
            } else if (req.type === 'get-peer-for-endpoint') {
                const source = this.peerSources.get(req.peerGroupId);

                if (source !== undefined) {
                    source.getPeerForEndpoint(req.endpoint).then(
                        (value: PeerInfo|undefined) => {

                            let peerInfoContext: PeerInfoContext|undefined = undefined;

                            if (value !== undefined) {
                                peerInfoContext = {
                                    endpoint: value.endpoint,
                                    identityHash: value.identityHash
                                };

                                if (value.identity !== undefined) {
                                    peerInfoContext.identity = value.identity.getLastLiteralContext();
                                }
                            }

                            this.commandForwardingFn({
                                type: 'forward-get-peer-for-endpoint-reply',
                                requestId: req.requestId,
                                peerInfoContext: peerInfoContext,
                                error: false
                        });
                        },
                        (_reason: any) => {
                            this.commandForwardingFn({
                                type: 'forward-get-peer-for-endpoint-reply',
                                requestId: req.requestId,
                                peerInfoContext: undefined,
                                error: true
                            });
                        })
                }
            }
        };

        this.pendingPeerGroupStates = new Map();
        this.pendingSyncStates      = new Map();

        this.syncObservers   = new Map();
        this.syncObserverIds = new Map();

        this.pendingAddSyncObserver = new Map();
        this.pendingRemoveSyncObserver = new Map();
    }

    getCommandStreamedReplyIngestFn() {
        return this.commandStreamedReplyIngestFn;
    }

    joinPeerGroup(pg: PeerGroupInfo, config?: PeerGroupAgentConfig, usageToken?: UsageToken): UsageToken {

        if (!this.peerSources.has(pg.id)) {
            this.peerSources.set(pg.id, pg.peerSource);
        }

        const token = usageToken || Mesh.createUsageToken();

        const cmd: JoinPeerGroup = {
            type: 'join-peer-group',
            peerGroupId: pg.id,
            localPeerEndpoint: pg.localPeer.endpoint,
            localPeerIdentityHash: pg.localPeer.identityHash,
            localPeerIdentity: pg.localPeer.identity === undefined? undefined : pg.localPeer.identity.getLastLiteralContext(),
            localPeerIdentityKeyPair: pg.localPeer.identity?._keyPair === undefined? undefined: pg.localPeer.identity._keyPair.getLastLiteralContext(),
            config: config,
            usageToken: token
        };

        this.commandForwardingFn(cmd);

        return token;
    }

    leavePeerGroup(usageToken: UsageToken) {
        const cmd: LeavePeerGroup = {
            type: 'leave-peer-group',
            usageToken: usageToken
        };

        this.commandForwardingFn(cmd);
    }

    async getPeerGroupState(peerGroupId: string, timeout=10000): Promise<PeerGroupState|undefined> {

        const p = new Promise<PeerGroupState|undefined>((resolve: (result: PeerGroupState|undefined) => void, reject: (reason: any) => void) => {
            const requestId = new RNGImpl().randomHexString(128);

            const cmd: ForwardPeerGroupState = {
                type: 'forward-peer-group-state',
                requestId: requestId,
                peerGroupId: peerGroupId
            };
    
            

            const to = window.setTimeout(() => {
                if (this.pendingPeerGroupStates.has(requestId)) {
                    this.pendingPeerGroupStates.delete(requestId)
                    reject('timeout');
                }
            }, timeout);

            this.pendingPeerGroupStates.set(requestId, {resolve: resolve, reject: reject, timeout: to});

            this.commandForwardingFn(cmd);
    
        });

        return p;
    }

    syncObjectWithPeerGroup(peerGroupId: string, obj: HashedObject, mode:SyncMode=SyncMode.full, usageToken?: UsageToken): UsageToken {
        
        const ctx = obj.getLastContext();

        let stores: any = {};

        for (const [hash, o] of ctx.objects.entries()) {
            const store = o.getStore();
            if (store !== undefined) {
                stores[hash] = {backendName: store.getBackendName(), dbName: store.getName()};
            }
        }

        let tokens: any = {}

        const token = usageToken || Mesh.createUsageToken();
        tokens[ctx.rootHashes[0]] = token;

        
        const cmd: SyncObjectsWithPeerGroup = {
            type:'sync-objects-with-peer-group',
            peerGroupId: peerGroupId,
            objContext: obj.getLastLiteralContext(),
            stores: stores,
            mode: mode,
            usageTokens: tokens
        };
        
        this.commandForwardingFn(cmd);

        return token;
    }

    syncManyObjectsWithPeerGroup(peerGroupId: string, objs: IterableIterator<HashedObject>, mode:SyncMode=SyncMode.full, usageTokens?: Map<Hash, UsageToken>): Map<Hash, UsageToken> {

        const objContext = new Context();
        let tokens: any = {}
        let resultTokens: Map<Hash, UsageToken> = new Map();

        for (const obj of objs) {
            objContext.merge(obj.getLastContext());
            const token = usageTokens?.get(obj.getLastHash()) || Mesh.createUsageToken();
            tokens[obj.getLastHash()] = token;
            resultTokens.set(obj.getLastHash(), token);
        }

        let stores: any = {};

        for (const [hash, o] of objContext.objects.entries()) {
            const store = o.getStore();
            if (store !== undefined) {
                stores[hash] = {backendName: store.getBackendName(), dbName: store.getName()};
            }
        }

        const cmd: SyncObjectsWithPeerGroup = {
            type: 'sync-objects-with-peer-group',
            peerGroupId: peerGroupId,
            objContext: objContext.toLiteralContext(),
            stores: stores,
            mode: mode,
            usageTokens: tokens
        };

        this.commandForwardingFn(cmd);

        return resultTokens;
    }

    stopSyncObjectWithPeerGroup(usageToken: UsageToken) {
        const cmd: StopSyncObjectsWithPeerGroup = {
            type: 'stop-sync-objects-with-peer-group',
            usageTokens: [usageToken]
        };

        this.commandForwardingFn(cmd);
    }

    stopSyncManyObjectsWithPeerGroup(usageTokens: IterableIterator<UsageToken>) {
        const cmd: StopSyncObjectsWithPeerGroup = {
            type: 'stop-sync-objects-with-peer-group',
            usageTokens: Array.from(usageTokens)
        };

        this.commandForwardingFn(cmd);
    }

    startObjectBroadcast(object: HashedObject, linkupServers: string[], replyEndpoints: Endpoint[], broadcastedSuffixBits?: number, usageToken?: UsageToken): UsageToken {
        
        if (usageToken === undefined) {
            usageToken = Mesh.createUsageToken();
        }

        const cmd: StartObjectBroadcast = {
            type: 'start-object-broadcast',
            objContext: object.getLastLiteralContext(),
            linkupServers: linkupServers,
            replyEndpoints: replyEndpoints,
            broadcastedSuffixBits: broadcastedSuffixBits,
            usageToken: usageToken
        }

        this.commandForwardingFn(cmd);

        return usageToken;
    }

    stopObjectBroadcast(usageToken: UsageToken) {
        const cmd: StopObjectBroadcast = {
            type: 'stop-object-broadcast',
            usageToken: usageToken
        }

        this.commandForwardingFn(cmd);
    }

    findObjectByHash(hash: Hash, linkupServers: string[], replyAddress: LinkupAddress, count=1, maxAge=30, strictEndpoints=false) : AsyncStream<ObjectDiscoveryReply> {
        const streamId = new RNGImpl().randomHexString(64);

        const src = new BufferingAsyncStreamSource<ObjectDiscoveryReply>()    

        this.discoveryStreamSources.set(streamId, src);

        const cmd: FindObjectByHash = {
            type: 'find-object-by-hash',
            hash: hash,
            linkupServers: linkupServers,
            replyEndpoint: replyAddress.url(),
            replyIdentity: replyAddress.identity === undefined? undefined: replyAddress.identity.getLastLiteralContext(),
            count: count,
            maxAge: maxAge,
            strictEndpoints: strictEndpoints,
            retry: false,
            streamId: streamId
        }

        this.commandForwardingFn(cmd);

        return new BufferedAsyncStream<ObjectDiscoveryReply>(src);
    }

    findObjectByHashSuffix(hashSuffix: string, linkupServers: string[], replyAddress: LinkupAddress, count=1, maxAge=30, strictEndpoints=false) : AsyncStream<ObjectDiscoveryReply> {
        const streamId = new RNGImpl().randomHexString(64);

        const src = new BufferingAsyncStreamSource<ObjectDiscoveryReply>()    

        this.discoveryStreamSources.set(streamId, src);

        const cmd: FindObjectByHashSuffix = {
            type: 'find-object-by-hash-suffix',
            hashSuffix: hashSuffix,
            linkupServers: linkupServers,
            replyEndpoint: replyAddress.url(),
            replyIdentity: replyAddress.identity === undefined? undefined: replyAddress.identity.getLastLiteralContext(),
            count: count,
            maxAge: maxAge,
            strictEndpoints: strictEndpoints,
            retry: false,
            streamId: streamId
        }

        this.commandForwardingFn(cmd);

        return new BufferedAsyncStream<ObjectDiscoveryReply>(src);
    }

    shutdown() {
        const cmd: Shutdown = { type: 'shutdown' };

        this.commandForwardingFn(cmd);
    }

    findObjectByHashRetry(hash: Hash, linkupServers: string[], replyAddress: LinkupAddress, count=1): void {
        const cmd: FindObjectByHash = {
            type: 'find-object-by-hash',
            hash: hash,
            linkupServers: linkupServers,
            replyEndpoint: replyAddress.url(),
            replyIdentity: replyAddress.identity === undefined? undefined: replyAddress.identity.getLastLiteralContext(),
            count: count,
            retry: true,
        }

        this.commandForwardingFn(cmd);
    }

    findObjectByHashSuffixRetry(hashSuffix: string, linkupServers: string[], replyAddress: LinkupAddress, count=1): void {    
        const cmd: FindObjectByHashSuffix = {
            type: 'find-object-by-hash-suffix',
            hashSuffix: hashSuffix,
            linkupServers: linkupServers,
            replyEndpoint: replyAddress.url(),
            replyIdentity: replyAddress.identity === undefined? undefined: replyAddress.identity.getLastLiteralContext(),
            count: count,
            retry: true,
        }

        this.commandForwardingFn(cmd);
    }

    addObjectSpawnCallback(callback: SpawnCallback, receiver: Identity, linkupServers: Array<string>, spawnId=ObjectSpawnAgent.defaultSpawnId) {
        
        const callbackId = new RNGImpl().randomHexString(128);

        this.spawnCallbacks.set(callbackId, callback);
        
        const cmd: AddObjectSpawnCallback = {
            type: 'add-object-spawn-callback',
            callbackId: callbackId,
            linkupServers: linkupServers,
            receiver: receiver.getLastLiteralContext(),
            receiverKeyPair: receiver.getKeyPair().getLastLiteralContext(),
            spawnId: spawnId
        }

        console.log('proxy forwarding addObjectSpawnCallback msg to host')

        this.commandForwardingFn(cmd);
    }

    sendObjectSpawnRequest(object: HashedObject, sender: Identity, receiver: Identity, senderEndpoint: Endpoint = new LinkupAddress(LinkupManager.defaultLinkupServer, LinkupAddress.undisclosedLinkupId).url(), receiverLinkupServers: Array<string>, spawnId=ObjectSpawnAgent.defaultSpawnId) {

        const cmd: SendObjectSpawnRequest = {
            type: 'send-object-spawn-callback',
            object: object.getLastLiteralContext(),
            receiver: receiver.getLastLiteralContext(),
            receiverLinkupServers: receiverLinkupServers,
            sender: sender.getLastLiteralContext(),
            senderKeyPair: sender.getKeyPair().getLastLiteralContext(),
            senderEndpoint: senderEndpoint,
            spawnId: spawnId
        }

        this.commandForwardingFn(cmd);

    }

    // We do not need to bridge this request to the MeshHost: the ObjectDiscoveryPeerSource receives a reference
    // to this mesh, that's already bridged.
    async getDiscoveryPeerGroup(obj: HashedObject, resources?: Resources) : Promise<PeerGroupInfo> {

        resources = resources || obj.getResources();

        if (resources === undefined) {
            throw new Error('Could not find a valid resources object to use for the discovery peer group.');
        }

        let localPeer = resources.getPeersForDiscovery()[0];
        let peerSource = new ObjectDiscoveryPeerSource(this as any as Mesh, obj, resources.config.linkupServers, LinkupAddress.fromURL(localPeer.endpoint, localPeer.identity), resources.getEndointParserForDiscovery());

        return {
            id: Mesh.discoveryPeerGroupId(obj),
            localPeer: localPeer,
            peerSource: peerSource
        };

    }

    getSyncState(mut: MutableObject, peerGroupId?: string | undefined, timeout=10000): Promise<SyncState | undefined> {
        const p = new Promise<SyncState|undefined>((resolve: (result: SyncState|undefined) => void, reject: (reason: any) => void) => {
            const requestId = new RNGImpl().randomHexString(128);

            const cmd: ForwardSyncState = {
                type: 'forward-sync-state',
                requestId: requestId,
                peerGroupId: peerGroupId,
                mutLiteralContext: mut.getLastLiteralContext()
            };
    
            

            const to = window.setTimeout(() => {
                if (this.pendingSyncStates.has(requestId)) {
                    this.pendingSyncStates.delete(requestId)
                    reject('timeout');
                }
            }, timeout);

            this.pendingSyncStates.set(requestId, {resolve: resolve, reject: reject, timeout: to, mut: mut});

            this.commandForwardingFn(cmd);
        });

        return p;
    }

    addSyncObserver(obs: SyncObserver, mut: MutableObject, peerGroupId?: string | undefined, timeout=10000): Promise<void> {
        const p = new Promise<void>((resolve: () => void, reject: (reason: any) => void) => {
            const observerId = new RNGImpl().randomHexString(128);

            const cmd: AddSyncObserver = {
                type: 'add-sync-observer',
                observerId: observerId,
                peerGroupId: peerGroupId,
                mutLiteralContext: mut.getLastLiteralContext()
            };
    
            

            const to = window.setTimeout(() => {
                if (this.pendingAddSyncObserver.has(observerId)) {
                    this.pendingAddSyncObserver.delete(observerId);
                    reject('timeout');
                }
            }, timeout);

            this.pendingAddSyncObserver.set(observerId, {resolve: resolve, reject: reject, timeout: to});

            this.syncObservers.set(observerId, [obs, mut]);
            this.syncObserverIds.set(obs, observerId);

            this.commandForwardingFn(cmd);
        });

        return p;
    }

    removeSyncObserver(obs: SyncObserver, mut: MutableObject, peerGroupId?: string | undefined, timeout=10000): Promise<void> {

        const p = new Promise<void>((resolve: () => void, reject: (reason: any) => void) => {
            const observerId = this.syncObserverIds.get(obs);

            if (observerId !== undefined) {
                const cmd: RemoveSyncObserver = {
                    type: 'remove-sync-observer',
                    observerId: observerId,
                    peerGroupId: peerGroupId,
                    mutLiteralContext: mut.getLastLiteralContext()
                };
                
                const to = window.setTimeout(() => {
                    if (this.pendingRemoveSyncObserver.has(observerId)) {
                        this.pendingRemoveSyncObserver.delete(observerId);
                        reject('timeout');
                    }
                }, timeout);
    
                this.pendingRemoveSyncObserver.set(observerId, {resolve: resolve, reject: reject, timeout: to});

                this.commandForwardingFn(cmd);
            } else {
                resolve();
            }

        });
    
        return p;
    }

}

export { MeshProxy };