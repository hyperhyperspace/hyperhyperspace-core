import { PeerGroupAgentConfig, PeerInfo, PeerSource } from 'mesh/agents/peer';
import { PeerGroupInfo, SyncMode } from 'mesh/service/Mesh';
import { MeshCommand,
    JoinPeerGroup, LeavePeerGroup,
    SyncObjectsWithPeerGroup, StopSyncObjectsWithPeerGroup,
    StartObjectBroadcast, StopObjectBroadcast,
    FindObjectByHash, FindObjectByHashSuffix, 
    CommandStreamedReply, LiteralObjectDiscoveryReply, DiscoveryEndReply,
    PeerSourceRequest } from './MeshHost';

import { RNGImpl } from 'crypto/random';
import { Context, Hash, HashedObject } from 'data/model';
import { AsyncStream, BufferedAsyncStream, BufferingAsyncStreamSource } from 'util/streams';
import { ObjectDiscoveryReply } from 'mesh/agents/discovery';
import { Endpoint } from 'mesh/agents/network';
import { LinkupManager, LinkupManagerCommand, LinkupManagerProxy } from 'net/linkup';
import { WebRTCConnectionEvent, WebRTCConnectionsHost } from 'net/transport';

class MeshProxy {

    commandForwardingFn: (cmd: MeshCommand) => void;
    discoveryStreamSources: Map<string, BufferingAsyncStreamSource<ObjectDiscoveryReply>>;
    commandStreamedReplyIngestFn: (reply: CommandStreamedReply) => void;

    linkup?: LinkupManagerProxy;
    webRTCConnsHost?: WebRTCConnectionsHost;

    peerSources: Map<string, PeerSource>;
    peerSourceRequestIngestFn: (req: PeerSourceRequest) => void;

    constructor(meshCommandFwdFn: (cmd: MeshCommand) => void, linkupCommandFwdFn?: (cmd: LinkupManagerCommand) => void, webRTCConnEventIngestFn?: (ev: WebRTCConnectionEvent) => void) {
        this.commandForwardingFn = meshCommandFwdFn;
        this.discoveryStreamSources = new Map();

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
                    object: HashedObject.fromLiteralContext(literalReply.objContext),
                    timestamp: literalReply.timestamp
                }

                this.discoveryStreamSources.get(literalReply.streamId)?.ingest(objReply);
            } else if (reply.type === 'object-discovery-end') {
                const endReply = reply as DiscoveryEndReply;
                this.discoveryStreamSources.get(endReply.streamId)?.end();
                this.discoveryStreamSources.delete(endReply.streamId)
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
                                peers: value,
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
                            this.commandForwardingFn({
                                type: 'forward-get-peer-for-endpoint-reply',
                                requestId: req.requestId,
                                peerInfo: value,
                                error: false
                        });
                        },
                        (_reason: any) => {
                            this.commandForwardingFn({
                                type: 'forward-get-peer-for-endpoint-reply',
                                requestId: req.requestId,
                                peerInfo: undefined,
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

    joinPeerGroup(pg: PeerGroupInfo, config?: PeerGroupAgentConfig) {

        if (!this.peerSources.has(pg.id)) {
            this.peerSources.set(pg.id, pg.peerSource);
        }

        const cmd: JoinPeerGroup = {
            type: 'join-peer-group',
            peerGroupId: pg.id,
            localPeerEndpoint: pg.localPeer.endpoint,
            localPeerIdentityHash: pg.localPeer.identityHash,
            localPeerIdentity: pg.localPeer.identity === undefined? undefined : pg.localPeer.identity.toLiteralContext(),
            localPeerIdentityKeyPair: pg.localPeer.identity?._keyPair === undefined? undefined: pg.localPeer.identity._keyPair.toLiteralContext(),
            config: config
        };

        this.commandForwardingFn(cmd);
    }

    isPeerGroupInUse(_peerGroupId: string, _gossipId?: string): boolean {
        throw new Error('MeshProxy does not support isPeerGroupInUse() yet.');
    }

    leavePeerGroup(peerGroupId: string) {
        const cmd: LeavePeerGroup = {
            type: 'leave-peer-group',
            peerGroupId: peerGroupId
        };

        this.commandForwardingFn(cmd);
    }

    syncObjectWithPeerGroup(peerGroupId: string, obj: HashedObject, mode:SyncMode=SyncMode.full, gossipId?: string) {
        
        const ctx = obj.toContext();

        let stores: any = {};

        for (const [hash, o] of ctx.objects.entries()) {
            const store = o.getStore();
            if (store !== undefined) {
                stores[hash] = {backendName: store.getBackendName(), dbName: store.getName()};
            }
        }
        
        const cmd: SyncObjectsWithPeerGroup = {
            type:'sync-objects-with-peer-group',
            peerGroupId: peerGroupId,
            objContext: obj.toLiteralContext(),
            stores: stores,
            mode: mode,
            gossipId: gossipId
        };
        
        this.commandForwardingFn(cmd);
    }

    syncManyObjectsWithPeerGroup(peerGroupId: string, objs: IterableIterator<HashedObject>, mode:SyncMode=SyncMode.full, gossipId?: string) {

        const objContext = new Context();

        for (const obj of objs) {
            objContext.merge(obj.toContext());
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
            gossipId: gossipId
        };

        this.commandForwardingFn(cmd);
    }

    stopSyncObjectWithPeerGroup(peerGroupId: string, hash: Hash, gossipId?: string) {
        const cmd: StopSyncObjectsWithPeerGroup = {
            type: 'stop-sync-objects-with-peer-group',
            peerGroupId: peerGroupId,
            hashes: [hash],
            gossipId: gossipId
        };

        this.commandForwardingFn(cmd);
    }

    stopSyncManyObjectsWithPeerGroup(peerGroupId: string, hashes: IterableIterator<Hash>, gossipId?: string) {
        const cmd: StopSyncObjectsWithPeerGroup = {
            type: 'stop-sync-objects-with-peer-group',
            peerGroupId: peerGroupId,
            hashes: Array.from(hashes),
            gossipId: gossipId
        };

        this.commandForwardingFn(cmd);
    }

    startObjectBroadcast(object: HashedObject, linkupServers: string[], replyEndpoints: Endpoint[], broadcastedSuffixBits?: number) {
        const cmd: StartObjectBroadcast = {
            type: 'start-object-broadcast',
            objContext: object.toLiteralContext(),
            linkupServers: linkupServers,
            replyEndpoints: replyEndpoints,
            broadcastedSuffixBits: broadcastedSuffixBits
        }

        this.commandForwardingFn(cmd);
    }

    stopObjectBroadcast(hash: Hash, broadcastedSuffixBits?: number) {
        const cmd: StopObjectBroadcast = {
            type: 'stop-object-broadcast',
            hash: hash,
            broadcastedSuffixBits: broadcastedSuffixBits
        }

        this.commandForwardingFn(cmd);
    }

    findObjectByHash(hash: Hash, linkupServers: string[], replyEndpoint: Endpoint, count=1, maxAge=30, strictEndpoints=false) : AsyncStream<ObjectDiscoveryReply> {
        const streamId = new RNGImpl().randomHexString(64);

        const src = new BufferingAsyncStreamSource<ObjectDiscoveryReply>()    

        this.discoveryStreamSources.set(streamId, src);

        const cmd: FindObjectByHash = {
            type: 'find-object-by-hash',
            hash: hash,
            linkupServers: linkupServers,
            replyEndpoint: replyEndpoint,
            count: count,
            maxAge: maxAge,
            strictEndpoints: strictEndpoints,
            retry: false,
            streamId: streamId
        }

        this.commandForwardingFn(cmd);

        return new BufferedAsyncStream<ObjectDiscoveryReply>(src);
    }

    findObjectByHashSuffix(hashSuffix: string, linkupServers: string[], replyEndpoint: Endpoint, count=1, maxAge=30, strictEndpoints=false) : AsyncStream<ObjectDiscoveryReply> {
        const streamId = new RNGImpl().randomHexString(64);

        const src = new BufferingAsyncStreamSource<ObjectDiscoveryReply>()    

        this.discoveryStreamSources.set(streamId, src);

        const cmd: FindObjectByHashSuffix = {
            type: 'find-object-by-hash-suffix',
            hashSuffix: hashSuffix,
            linkupServers: linkupServers,
            replyEndpoint: replyEndpoint,
            count: count,
            maxAge: maxAge,
            strictEndpoints: strictEndpoints,
            retry: false,
            streamId: streamId
        }

        this.commandForwardingFn(cmd);

        return new BufferedAsyncStream<ObjectDiscoveryReply>(src);
    }

    findObjectByHashRetry(hash: Hash, linkupServers: string[], replyEndpoint: Endpoint, count=1): void {
        const cmd: FindObjectByHash = {
            type: 'find-object-by-hash',
            hash: hash,
            linkupServers: linkupServers,
            replyEndpoint: replyEndpoint,
            count: count,
            retry: true,
        }

        this.commandForwardingFn(cmd);
    }

    findObjectByHashSuffixRetry(hashSuffix: string, linkupServers: string[], replyEndpoint: Endpoint, count=1): void {    
        const cmd: FindObjectByHashSuffix = {
            type: 'find-object-by-hash-suffix',
            hashSuffix: hashSuffix,
            linkupServers: linkupServers,
            replyEndpoint: replyEndpoint,
            count: count,
            retry: true,
        }

        this.commandForwardingFn(cmd);
    }



}

export { MeshProxy };