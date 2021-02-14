import { PeerGroupAgentConfig, PeerInfo, PeerSource } from '../../agents/peer';
import { Mesh, SyncMode } from '../../service/Mesh';
import { Context, HashedObject, LiteralContext } from 'data/model';
import { Hash } from 'data/model';
import { Endpoint } from 'mesh/agents/network';
import { AsyncStream } from 'util/streams';
import { ObjectDiscoveryReply } from 'mesh/agents/discovery';
import { RNGImpl } from 'crypto/random';
import { Identity, RSAKeyPair } from 'data/identity';
import { Store } from 'storage/store';

type MeshCommand = JoinPeerGroup | CheckPeerGroupUsage | LeavePeerGroup |
                   SyncObjectsWithPeerGroup | StopSyncObjectsWithPeerGroup |
                   StartObjectBroadcast | StopObjectBroadcast |
                   FindObjectByHash | FindObjectByHashSuffix | 
                   ForwardGetPeersReply | ForwardGetPeerForEndpointReply;

type JoinPeerGroup = {
    type: 'join-peer-group';
    //peerGroupInfo: PeerGroupInfo;
    peerGroupId: string,
    localPeerEndpoint: Endpoint;
    localPeerIdentityHash: Hash;
    localPeerIdentity?: LiteralContext | undefined,
    localPeerIdentityKeyPair?: LiteralContext | undefined,
    //localPeer: PeerInfo,
    config?: PeerGroupAgentConfig;
};

type CheckPeerGroupUsage = {
    type: 'check-peer-group-usage';
    peerGroupId: string;
    gossipId?: string;
}

type LeavePeerGroup = {
    type: 'leave-peer-group';
    peerGroupId: string;
}

type SyncObjectsWithPeerGroup = {
    type: 'sync-objects-with-peer-group';
    peerGroupId: string;
    objContext: LiteralContext;
    stores: any,
    mode: SyncMode;
    gossipId?: string;
}

type StopSyncObjectsWithPeerGroup = {
    type: 'stop-sync-objects-with-peer-group';
    peerGroupId: string;
    hashes: Array<Hash>;
    gossipId?: string;
}

type StartObjectBroadcast = {
    type: 'start-object-broadcast';
    objContext: LiteralContext;
    linkupServers: Array<string>;
    replyEndpoints: Array<Endpoint>;
    broadcastedSuffixBits?: number;
}

type StopObjectBroadcast = {
    type: 'stop-object-broadcast';
    hash: Hash;
    broadcastedSuffixBits?: number;
}

type FindObjectByHash = {
    type: 'find-object-by-hash';
    hash: Hash;
    linkupServers: Array<string>;
    replyEndpoint: Endpoint;
    count?: number;
    maxAge?: number;
    strictEndpoints?: boolean;
    retry: boolean;
    streamId?: string; // used when retry is false
}

type FindObjectByHashSuffix = {
    type: 'find-object-by-hash-suffix';
    hashSuffix: string;
    linkupServers: Array<string>;
    replyEndpoint: Endpoint;
    count?: number;
    maxAge?: number;
    strictEndpoints?: boolean;
    retry: boolean;
    streamId?: string; // used when retry is false
}

type ForwardGetPeersReply = {
    type: 'forward-get-peers-reply'
    requestId: string,
    peers: PeerInfo[],
    error: boolean
}

type ForwardGetPeerForEndpointReply = {
    type: 'forward-get-peer-for-endpoint-reply'
    requestId: string,
    peerInfo: PeerInfo | undefined,
    error: boolean
}

type CommandStreamedReply = LiteralObjectDiscoveryReply | DiscoveryEndReply;

type LiteralObjectDiscoveryReply = {
    type: 'object-discovery-reply'
    streamId: string;
    source: Endpoint, 
    destination: Endpoint, 
    hash: Hash, 
    objContext: LiteralContext, 
    timestamp: number
};

type DiscoveryEndReply = {
    type: 'object-discovery-end';
    streamId: string;
}


type PeerSourceRequest = GetPeersRequest | GetPeerForEndpointRequest;

type GetPeersRequest = { 
    type: 'get-peers',
    peerGroupId: string,
    count: number,
    requestId: string
};

type GetPeerForEndpointRequest = { 
    type: 'get-peer-for-endpoint',
    peerGroupId: string,
    endpoint: Endpoint,
    requestId: string
};



class MeshHost {

    static isCommand(msg: any): boolean {

        const type = msg?.type;

        return (type === 'join-peer-group' ||
            type === 'check-peer-group-usage' ||
            type === 'leave-peer-group' ||
            type === 'sync-objects-with-peer-group' ||
            type === 'stop-sync-objects-with-peer-group' ||
            type === 'start-object-broadcast' ||
            type === 'stop-object-broadcast' ||
            type === 'find-object-by-hash' ||
            type === 'find-object-by-hash-suffix' ||
            type === 'object-discovery-reply' ||
            type === 'object-discovery-end' ||
            type === 'forward-get-peers-reply' ||
            type === 'forward-get-peer-for-endpoint-reply');
    }

    static isStreamedReply(msg: any): boolean {
        const type = msg?.type;

        return (type === 'object-discovery-reply' ||
                type === 'object-discovery-end');
    }

    static isPeerSourceRequest(msg: any): boolean {
        const type = msg?.type;

        return (type === 'get-peers' || type === 'get-peer-for-endpoint');
    }


    mesh: Mesh;
    streamedReplyCb: (resp: CommandStreamedReply) => void;
    peerSourceReqCb: (req: PeerSourceRequest) => void;

    pendingPeersRequests: Map<string, {resolve: (value: PeerInfo[] | PromiseLike<PeerInfo[]>) => void, reject: (reason?: any) => void}>;
    pendingPeerForEndpointRequests: Map<string, {resolve: (value: (PeerInfo | undefined) | PromiseLike<PeerInfo | undefined>) => void, reject: (reason?: any) => void}>;

    stores: Map<string, Map<string, Store>>;

    constructor(mesh: Mesh, streamedReplyCb: (resp: CommandStreamedReply) => void, peerSourceReqCb: (req: PeerSourceRequest) => void) {
        this.mesh = mesh;
        this.streamedReplyCb = streamedReplyCb;
        this.peerSourceReqCb = peerSourceReqCb;
        this.pendingPeersRequests = new Map();
        this.pendingPeerForEndpointRequests = new Map();
        this.stores = new Map();
    }

    execute(command: MeshCommand) : void {

        //let error: string | undefined;

        if (command.type === 'join-peer-group') {
            const join = command as JoinPeerGroup;
            let peerSource = new PeerSourceProxy(this, join.peerGroupId);

            const identity = (join.localPeerIdentity === undefined? undefined : HashedObject.fromLiteralContext(join.localPeerIdentity) as Identity);

            if (identity !== undefined && join.localPeerIdentityKeyPair !== undefined) {
                identity._keyPair = HashedObject.fromLiteralContext(join.localPeerIdentityKeyPair) as RSAKeyPair;
            }

            let localPeer: PeerInfo = {
                endpoint: join.localPeerEndpoint,
                identityHash: join.localPeerIdentityHash,
                identity: identity
            }

            this.mesh.joinPeerGroup({id: join.peerGroupId, localPeer: localPeer, peerSource: peerSource}, join.config);
        } else if (command.type === 'check-peer-group-usage') {
            const check = command as CheckPeerGroupUsage;
            this.mesh.isPeerGroupInUse(check.peerGroupId, check.gossipId);
            
            // TODO: send reply somehow :*(

        } else if (command.type === 'leave-peer-group') {
            const leave = command as LeavePeerGroup;
            this.mesh.leavePeerGroup(leave.peerGroupId);
        } else if (command.type === 'sync-objects-with-peer-group') {
            const syncObjs = command as SyncObjectsWithPeerGroup;

            let objs: Array<HashedObject> = [];

            let context = new Context();
            context.fromLiteralContext(syncObjs.objContext);

            for (const hash of syncObjs.objContext.rootHashes) {
                const obj = HashedObject.fromContext(context, hash);
                objs.push(obj);
            }

            for (const [hash, obj] of context.objects.entries()) {
                if (syncObjs.stores[hash] !== undefined) {
                    const backendName = syncObjs.stores[hash]['backendName'];
                    const dbName = syncObjs.stores[hash]['dbName']

                    if (!this.stores.has(backendName)) {
                        this.stores.set(backendName, new Map());
                    }

                    let db = this.stores.get(backendName)?.get(dbName);

                    if (db === undefined) {
                        db = Store.load(backendName, dbName);
                        if (db !== undefined) {
                            this.stores.get(backendName)?.set(dbName, db);
                        }
                    }

                    if (db !== undefined) {
                        obj.setStore(db);
                        console.log('set store ' + dbName + ' for ' + hash);
                    } else {
                        console.log('missing store');
                    }
                } else {
                    console.log('missing store info for ' + hash);
                }
            }


            


            
            this.mesh.syncManyObjectsWithPeerGroup(
                syncObjs.peerGroupId, objs.values(), syncObjs.mode, syncObjs.gossipId
            );
        } else if (command.type === 'stop-sync-objects-with-peer-group') {
            const stopSyncObjs = command as StopSyncObjectsWithPeerGroup;

            this.mesh.stopSyncManyObjectsWithPeerGroup(
                stopSyncObjs.peerGroupId, stopSyncObjs.hashes.values(), stopSyncObjs.gossipId
            );
        } else if (command.type === 'start-object-broadcast') {
            const startBcast = command as StartObjectBroadcast;

            let obj = HashedObject.fromLiteralContext(startBcast.objContext);

            this.mesh.startObjectBroadcast(
                obj, startBcast.linkupServers, startBcast.replyEndpoints, startBcast.broadcastedSuffixBits
            );

        } else if (command.type === 'stop-object-broadcast') {
            const stopBcast = command as StopObjectBroadcast;
            this.mesh.stopObjectBroadcast(stopBcast.hash, stopBcast.broadcastedSuffixBits);
        } else if (command.type === 'find-object-by-hash' ||
                   command.type === 'find-object-by-hash-suffix') {
            const find = command as FindObjectByHash | FindObjectByHashSuffix;

            if (!find.retry) {

                const streamId = command.streamId;
                let replyStream: AsyncStream<ObjectDiscoveryReply>;

                if (command.type === 'find-object-by-hash') {
                    replyStream = this.mesh.findObjectByHash(
                        (find as FindObjectByHash).hash, find.linkupServers, find.replyEndpoint, find.count, find.maxAge, find.strictEndpoints
                    );
                } else {
                    replyStream = this.mesh.findObjectByHashSuffix(
                        (find as FindObjectByHashSuffix).hashSuffix, find.linkupServers, find.replyEndpoint, find.count, find.maxAge, find.strictEndpoints
                    );
                }
                

                const tt = setTimeout(async () => {


                    try {
                        while (!replyStream.atEnd()) {
                            const discov = await replyStream.next();

                            let reply: LiteralObjectDiscoveryReply = {
                                type: 'object-discovery-reply',
                                streamId: streamId as string,
                                source: discov.source, 
                                destination: discov.destination,
                                hash: discov.hash, 
                                objContext: discov.object.toLiteralContext(), 
                                timestamp: discov.timestamp
                            };

                            this.streamedReplyCb(reply)

                        }


                    } finally {
                        let replyEnd: DiscoveryEndReply = {
                            type: 'object-discovery-end',
                            streamId: streamId as string
                        }

                        this.streamedReplyCb(replyEnd);
                        clearTimeout(tt);
                    }

                }, 0);


            } else {
                if (command.type === 'find-object-by-hash') {
                    this.mesh.findObjectByHashRetry(
                        (find as FindObjectByHash).hash, find.linkupServers, find.replyEndpoint, find.count
                    );
                } else {
                    this.mesh.findObjectByHashSuffixRetry(
                        (find as FindObjectByHashSuffix).hashSuffix, find.linkupServers, find.replyEndpoint, find.count
                    );
                }
            }
        } else if (command.type === 'forward-get-peers-reply') {

            console.log('GET PEERS REPLY');

            const reply = command as ForwardGetPeersReply;

            let ex = this.pendingPeersRequests.get(reply.requestId);

            if (ex !== undefined) {
                if (reply.error) {
                    ex.reject('Received rejection through remoting');
                } else {
                    ex.resolve(reply.peers);
                }
            }
        } else if (command.type === 'forward-get-peer-for-endpoint-reply') {

            console.log('GET PEER FOR ENDPOINT REPLY');

            const reply = command as ForwardGetPeerForEndpointReply;

            let ex = this.pendingPeerForEndpointRequests.get(reply.requestId);

            if (ex !== undefined) {
                if (reply.error) {
                    ex.reject('Received rejection through remoting');
                } else {
                    ex.resolve(reply.peerInfo);
                }
            }
        } else {
            console.log('UNKNOWN:')
            console.log(command);
        }
    }

    registerPeersRequest(requestId: string, executor: {resolve: (value: PeerInfo[] | PromiseLike<PeerInfo[]>) => void, reject: (reason?: any) => void}) {
        this.pendingPeersRequests.set(requestId, executor);
    }

    registerPeerForEndpointRequest(requestId: string, executor: {resolve: (value: (PeerInfo | undefined) | PromiseLike<PeerInfo | undefined>) => void, reject: (reason?: any) => void}) {
        this.pendingPeerForEndpointRequests.set(requestId, executor);
    }
}

class PeerSourceProxy implements PeerSource {

    host: MeshHost;
    peerGroupId: string;

    constructor(host: MeshHost, peerGroupId: string) {
        this.host = host;
        this.peerGroupId = peerGroupId;
    }

    getPeers(count: number): Promise<PeerInfo[]> {

        let requestId = new RNGImpl().randomHexString(128);

        let result = new Promise<PeerInfo[]>((resolve: (value: PeerInfo[] | PromiseLike<PeerInfo[]>) => void, reject: (reason?: any) => void) => {
            this.host.registerPeersRequest(requestId, {resolve: resolve, reject: reject});
        });

        this.host.peerSourceReqCb({
            type: 'get-peers', 
            peerGroupId: this.peerGroupId, 
            count: count,
            requestId: requestId
        });

    return result;        
    }

    getPeerForEndpoint(endpoint: string): Promise<PeerInfo | undefined> {
        let requestId = new RNGImpl().randomHexString(128);

        let result = new Promise<PeerInfo | undefined>((resolve: (value: PeerInfo | PromiseLike<PeerInfo | undefined> | undefined) => void, reject: (reason?: any) => void) => {
            this.host.registerPeerForEndpointRequest(requestId, {resolve: resolve, reject: reject});
        });

        this.host.peerSourceReqCb({
            type: 'get-peer-for-endpoint',
            peerGroupId: this.peerGroupId,
            endpoint: endpoint,
            requestId: requestId   
        });

        return result;
    }
    
}

export { MeshHost, MeshCommand,
         JoinPeerGroup, CheckPeerGroupUsage, LeavePeerGroup,
         SyncObjectsWithPeerGroup, StopSyncObjectsWithPeerGroup,
         StartObjectBroadcast, StopObjectBroadcast,
         FindObjectByHash, FindObjectByHashSuffix,
         CommandStreamedReply, LiteralObjectDiscoveryReply, DiscoveryEndReply, 
         ForwardGetPeersReply, ForwardGetPeerForEndpointReply,
         PeerSourceRequest, GetPeersRequest, GetPeerForEndpointRequest };