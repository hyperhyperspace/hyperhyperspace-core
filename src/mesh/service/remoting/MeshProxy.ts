import { PeerGroupAgentConfig, PeerInfo, PeerSource } from 'mesh/agents/peer';
import { Mesh, PeerGroupInfo, SyncMode, UsageToken } from 'mesh/service/Mesh';
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
    SendObjectSpawnRequest} from './MeshHost';

import { RNGImpl } from 'crypto/random';
import { Context, Hash, HashedObject } from 'data/model';
import { AsyncStream, BufferedAsyncStream, BufferingAsyncStreamSource } from 'util/streams';
import { ObjectDiscoveryReply } from 'mesh/agents/discovery';
import { Endpoint } from 'mesh/agents/network';
import { LinkupAddress, LinkupManager, LinkupManagerCommand, LinkupManagerProxy } from 'net/linkup';
import { WebRTCConnectionEvent, WebRTCConnectionsHost } from 'net/transport';
import { Identity } from 'data/identity';
import { ObjectSpawnAgent, SpawnCallback } from 'mesh/agents/spawn';

/* Access a mesh remotely, see the MeshHost class. */

class MeshProxy {

    commandForwardingFn: (cmd: MeshCommand) => void;
    discoveryStreamSources: Map<string, BufferingAsyncStreamSource<ObjectDiscoveryReply>>;
    spawnCallbacks: Map<string, SpawnCallback>;
    commandStreamedReplyIngestFn: (reply: CommandStreamedReply) => void;

    linkup?: LinkupManagerProxy;
    webRTCConnsHost?: WebRTCConnectionsHost;

    peerSources: Map<string, PeerSource>;
    peerSourceRequestIngestFn: (req: PeerSourceRequest) => void;

    

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
                                peers: value.map((pi: PeerInfo) => { return {endpoint: pi.endpoint, identityHash: pi.identityHash, identity: pi.identity?.toLiteralContext()}; }),
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
                                    peerInfoContext.identity = value.identity.toLiteralContext();
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
            localPeerIdentity: pg.localPeer.identity === undefined? undefined : pg.localPeer.identity.toLiteralContext(),
            localPeerIdentityKeyPair: pg.localPeer.identity?._keyPair === undefined? undefined: pg.localPeer.identity._keyPair.toLiteralContext(),
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

    syncObjectWithPeerGroup(peerGroupId: string, obj: HashedObject, mode:SyncMode=SyncMode.full, gossipId?: string, usageToken?: UsageToken): UsageToken {
        
        const ctx = obj.toContext();

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
            objContext: obj.toLiteralContext(),
            stores: stores,
            mode: mode,
            gossipId: gossipId,
            usageTokens: tokens
        };
        
        this.commandForwardingFn(cmd);

        return token;
    }

    syncManyObjectsWithPeerGroup(peerGroupId: string, objs: IterableIterator<HashedObject>, mode:SyncMode=SyncMode.full, gossipId?: string, usageTokens?: Map<Hash, UsageToken>): Map<Hash, UsageToken> {

        const objContext = new Context();
        let tokens: any = {}
        let resultTokens: Map<Hash, UsageToken> = new Map();

        for (const obj of objs) {
            objContext.merge(obj.toContext());
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
            gossipId: gossipId,
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
            objContext: object.toLiteralContext(),
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
            replyIdentity: replyAddress.identity === undefined? undefined: replyAddress.identity.toLiteralContext(),
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
            replyIdentity: replyAddress.identity === undefined? undefined: replyAddress.identity.toLiteralContext(),
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
            replyIdentity: replyAddress.identity === undefined? undefined: replyAddress.identity.toLiteralContext(),
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
            replyIdentity: replyAddress.identity === undefined? undefined: replyAddress.identity.toLiteralContext(),
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
            receiver: receiver.toLiteralContext(),
            spawnId: spawnId
        }

        this.commandForwardingFn(cmd);
    }

    sendObjectSpawnRequest(object: HashedObject, sender: Identity, receiver: Identity, senderEndpoint: Endpoint = new LinkupAddress(LinkupManager.defaultLinkupServer, LinkupAddress.undisclosedLinkupId).url(), receiverLinkupServers: Array<string>, spawnId=ObjectSpawnAgent.defaultSpawnId) {

        const cmd: SendObjectSpawnRequest = {
            type: 'send-object-spawn-callback',
            object: object.toLiteralContext(),
            receiver: receiver.toLiteralContext(),
            receiverLinkupServers: receiverLinkupServers,
            sender: sender.toLiteralContext(),
            senderEndpoint: senderEndpoint,
            spawnId: spawnId
        }

        this.commandForwardingFn(cmd);

    }


}

export { MeshProxy };