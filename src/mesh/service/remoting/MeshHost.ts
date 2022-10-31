import { PeerGroupAgentConfig, PeerInfo, PeerSource } from '../../agents/peer';
import { Mesh, SyncMode, UsageToken } from '../../service/Mesh';
import { SpawnCallback } from '../../agents/spawn';
import { PeerGroupState } from '../../agents/peer/PeerGroupState';
import { ObjectDiscoveryReply } from '../../agents/discovery';
import { Endpoint } from '../../agents/network';

import { Identity, RSAKeyPair } from 'data/identity';
import { Context, HashedObject, LiteralContext } from 'data/model';
import { Hash } from 'data/model';

import { AsyncStream } from 'util/streams';

import { RNGImpl } from 'crypto/random';

import { Store } from 'storage/store';
import { LinkupAddress } from 'net/linkup';

/* Run a mesh remotely, and access it through a MeshProxy */

/* This was added to be able to run the mesh in a WebWorker, so all the sync work is done
 * in a different thread and doesn't interfere with UI rendering.
 * 
 * WebRTC, however, doesn't work in WebWorkers, so the actuall p2p networking is done in the
 * main thread, and bridged over to the worker.
 * 
 * MeshHost and MeshProxy just do the marshalling / forwarding part over functiosn that are
 * parametrized, WebWorkerMeshHost and WebWorkerMeshProxy provide implementations of those
 * functions for the WebWorker case.
 * 
 * Ah, the things we do for you, Hyper Hyper Space. */

type MeshCommand = JoinPeerGroup | LeavePeerGroup | ForwardPeerGroupState |
                   SyncObjectsWithPeerGroup | StopSyncObjectsWithPeerGroup |
                   StartObjectBroadcast | StopObjectBroadcast |
                   FindObjectByHash | FindObjectByHashSuffix |  Shutdown |
                   ForwardGetPeersReply | ForwardGetPeerForEndpointReply |
                   AddObjectSpawnCallback | SendObjectSpawnRequest;

type JoinPeerGroup = {
    type: 'join-peer-group';
    //peerGroupInfo: PeerGroupInfo;
    peerGroupId: string,
    localPeerEndpoint: Endpoint;
    localPeerIdentityHash: Hash;
    localPeerIdentity?: LiteralContext,
    localPeerIdentityKeyPair?: LiteralContext,
    //localPeer: PeerInfo,
    config?: PeerGroupAgentConfig;
    usageToken?: UsageToken
};

type LeavePeerGroup = {
    type: 'leave-peer-group',
    usageToken: UsageToken
}

type ForwardPeerGroupState = {
    type: 'forward-peer-group-state',
    requestId: string,
    peerGroupId: string
}

type SyncObjectsWithPeerGroup = {
    type: 'sync-objects-with-peer-group',
    peerGroupId: string,
    objContext: LiteralContext,
    stores: any,
    mode: SyncMode,
    usageTokens?: any
}

type StopSyncObjectsWithPeerGroup = {
    type: 'stop-sync-objects-with-peer-group',
    usageTokens: Array<UsageToken>
}

type StartObjectBroadcast = {
    type: 'start-object-broadcast',
    objContext: LiteralContext,
    linkupServers: Array<string>,
    replyEndpoints: Array<Endpoint>,
    broadcastedSuffixBits?: number,
    usageToken?: UsageToken
}

type StopObjectBroadcast = {
    type: 'stop-object-broadcast',
    usageToken: UsageToken
}

type FindObjectByHash = {
    type: 'find-object-by-hash',
    hash: Hash,
    linkupServers: Array<string>,
    replyEndpoint: Endpoint,
    replyIdentity?: LiteralContext,
    count?: number,
    maxAge?: number,
    strictEndpoints?: boolean,
    includeErrors?: boolean,
    retry: boolean,
    streamId?: string // used when retry is false
}

type FindObjectByHashSuffix = {
    type: 'find-object-by-hash-suffix',
    hashSuffix: string,
    linkupServers: Array<string>,
    replyEndpoint: Endpoint,
    replyIdentity?: LiteralContext,
    count?: number,
    maxAge?: number,
    includeErrors?: boolean,
    strictEndpoints?: boolean,
    retry: boolean,
    streamId?: string // used when retry is false
}

type AddObjectSpawnCallback = {
    type: 'add-object-spawn-callback',
    receiver: LiteralContext,
    receiverKeyPair: LiteralContext,
    linkupServers: Array<string>,
    spawnId: string,
    callbackId: string
}

type SendObjectSpawnRequest = {
    type: 'send-object-spawn-callback',
    object: LiteralContext,
    receiver: LiteralContext,
    receiverLinkupServers: Array<string>,
    sender: LiteralContext,
    senderKeyPair: LiteralContext,
    senderEndpoint: string,
    spawnId: string
}

type Shutdown = {
    type: 'shutdown'
}

type ForwardGetPeersReply = {
    type: 'forward-get-peers-reply'
    requestId: string,
    peers: {endpoint: Endpoint, identityHash: Hash, identity?: LiteralContext}[],
    error: boolean
}

type ForwardGetPeerForEndpointReply = {
    type: 'forward-get-peer-for-endpoint-reply'
    requestId: string,
    peerInfoContext: PeerInfoContext | undefined,
    error: boolean
}

type PeerInfoContext = { endpoint: Endpoint, identityHash: Hash, identity?: LiteralContext };

type CommandStreamedReply = LiteralObjectDiscoveryReply | DiscoveryEndReply | ObjectSpawnCallback | PeerGroupStateReply;

type LiteralObjectDiscoveryReply = {
    type: 'object-discovery-reply'
    streamId: string;
    source: Endpoint, 
    destination: Endpoint, 
    hash: Hash, 
    objContext?: LiteralContext, 
    error?: string,
    timestamp: number
};

type DiscoveryEndReply = {
    type: 'object-discovery-end';
    streamId: string;
}

type ObjectSpawnCallback = {
    type: 'object-spawn-callback',
    callbackId: string,
    object: LiteralContext,
    sender: LiteralContext,
    senderEndpoint: string
}

type LiteralPeerInfo =  { endpoint: Endpoint, identityHash: Hash, identity?: LiteralContext };

type PeerGroupStateReply = {
    type: 'peer-group-state-reply',
    requestId: string,
    local?: LiteralPeerInfo,
    remote?: Array<LiteralPeerInfo>
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
            type === 'forward-peer-group-state' ||
            type === 'sync-objects-with-peer-group' ||
            type === 'stop-sync-objects-with-peer-group' ||
            type === 'start-object-broadcast' ||
            type === 'stop-object-broadcast' ||
            type === 'find-object-by-hash' ||
            type === 'find-object-by-hash-suffix' ||
            type === 'shutdown' ||
            type === 'object-discovery-reply' ||
            type === 'object-discovery-end' ||
            type === 'forward-get-peers-reply' ||
            type === 'forward-get-peer-for-endpoint-reply' || 
            type === 'add-object-spawn-callback' ||
            type === 'send-object-spawn-callback'
            );
    }

    static isStreamedReply(msg: any): boolean {
        const type = msg?.type;

        return (type === 'object-discovery-reply' ||
                type === 'object-discovery-end'   || 
                type === 'object-spawn-callback'  ||
                type === 'peer-group-state-reply');
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

    spawnCallbacks: Map<string, SpawnCallback>;

    stores: Map<string, Map<string, Store>>;

    constructor(mesh: Mesh, streamedReplyCb: (resp: CommandStreamedReply) => void, peerSourceReqCb: (req: PeerSourceRequest) => void) {
        this.mesh = mesh;
        this.streamedReplyCb = streamedReplyCb;
        this.peerSourceReqCb = peerSourceReqCb;
        this.pendingPeersRequests = new Map();
        this.pendingPeerForEndpointRequests = new Map();
        this.spawnCallbacks = new Map();
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

            this.mesh.joinPeerGroup({id: join.peerGroupId, localPeer: localPeer, peerSource: peerSource}, join.config, join.usageToken);
        } else if (command.type === 'leave-peer-group') {
            const leave = command as LeavePeerGroup;
            this.mesh.leavePeerGroup(leave.usageToken);

        } else if (command.type === 'forward-peer-group-state') {

            this.mesh.getPeerGroupState(command.peerGroupId).then((state: PeerGroupState|undefined) => {

                const reply: PeerGroupStateReply = {
                    type: 'peer-group-state-reply',
                    requestId: command.requestId,
                }

                if (state !== undefined) {
                    const local: LiteralPeerInfo = {endpoint: state.local.endpoint, identityHash: state.local.identityHash};

                    if (state.local.identity !== undefined) {
                        local.identity = state.local.identity.toLiteralContext();
                    }

                    reply.local = local;

                    reply.remote = [];

                    for (const peerInfo of state.remote.values()) {
                        const lit: LiteralPeerInfo = {endpoint: peerInfo.endpoint, identityHash: peerInfo.identityHash};

                        if (peerInfo.identity !== undefined) {
                            lit.identity = peerInfo.identity.toLiteralContext();
                        }

                        reply.remote.push(lit);
                    }
                }

                this.streamedReplyCb(reply);

            })

        } else if (command.type === 'sync-objects-with-peer-group') {
            const syncObjs = command as SyncObjectsWithPeerGroup;

            let objs: Array<HashedObject> = [];
            let tokens: Map<Hash, UsageToken> | undefined = undefined;

            if (syncObjs.usageTokens !== undefined) {
                tokens = new Map();
            }

            let context = new Context();
            context.fromLiteralContext(syncObjs.objContext);

            for (const hash of syncObjs.objContext.rootHashes) {
                const obj = HashedObject.fromContext(context, hash);
                objs.push(obj);
                if (tokens !== undefined) {
                    tokens.set(hash, syncObjs.usageTokens[hash])
                }
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
                    } else {
                        console.log('WARNING: missing store for ' + hash);
                    }
                }
            }
            
            this.mesh.syncManyObjectsWithPeerGroup(
                syncObjs.peerGroupId, objs.values(), syncObjs.mode, tokens
            );
        } else if (command.type === 'stop-sync-objects-with-peer-group') {
            const stopSyncObjs = command as StopSyncObjectsWithPeerGroup;

            this.mesh.stopSyncManyObjectsWithPeerGroup(
                stopSyncObjs.usageTokens.values()
            );
        } else if (command.type === 'start-object-broadcast') {
            const startBcast = command as StartObjectBroadcast;

            let obj = HashedObject.fromLiteralContext(startBcast.objContext);

            this.mesh.startObjectBroadcast(
                obj, startBcast.linkupServers, startBcast.replyEndpoints, startBcast.broadcastedSuffixBits, startBcast.usageToken
            );

        } else if (command.type === 'stop-object-broadcast') {
            const stopBcast = command as StopObjectBroadcast;
            this.mesh.stopObjectBroadcast(stopBcast.usageToken);
        } else if (command.type === 'find-object-by-hash' ||
                   command.type === 'find-object-by-hash-suffix') {
            const find = command as FindObjectByHash | FindObjectByHashSuffix;

            const id = find.replyIdentity === undefined? undefined : HashedObject.fromLiteralContext(find.replyIdentity) as Identity;
            const replyAddress = LinkupAddress.fromURL(find.replyEndpoint, id);

            if (!find.retry) {

                const streamId = command.streamId;
                let replyStream: AsyncStream<ObjectDiscoveryReply>;

                if (command.type === 'find-object-by-hash') {
                    replyStream = this.mesh.findObjectByHash(
                        (find as FindObjectByHash).hash, find.linkupServers, replyAddress, find.count, find.maxAge, find.strictEndpoints, find.includeErrors
                    );
                } else {
                    replyStream = this.mesh.findObjectByHashSuffix(
                        (find as FindObjectByHashSuffix).hashSuffix, find.linkupServers, replyAddress, find.count, find.maxAge, find.strictEndpoints, find.includeErrors
                    );
                }
                

                const tt = setTimeout(async () => {


                    try {
                        while (!replyStream.atEnd()) {

                            try {
                                const discov = await replyStream.next();

                                let reply: LiteralObjectDiscoveryReply = {
                                    type: 'object-discovery-reply',
                                    streamId: streamId as string,
                                    source: discov.source, 
                                    destination: discov.destination,
                                    hash: discov.hash, 
                                    objContext: discov.object?.toLiteralContext(), 
                                    error: discov.error,
                                    timestamp: discov.timestamp
                                };
    
                                this.streamedReplyCb(reply)
                            } catch (e) {
                                if (e !== 'end') {
                                    throw e;
                                }
                            }
                            

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
                        (find as FindObjectByHash).hash, find.linkupServers, replyAddress, find.count
                    );
                } else {
                    this.mesh.findObjectByHashSuffixRetry(
                        (find as FindObjectByHashSuffix).hashSuffix, find.linkupServers, replyAddress, find.count
                    );
                }
            }
        } else if (command.type === 'add-object-spawn-callback') {

            let cb = this.spawnCallbacks.get(command.callbackId);

            if (cb === undefined) {
                cb = (object: HashedObject, sender: Identity, senderEndpoint: string) => {
                    const msg: ObjectSpawnCallback = {
                        type: 'object-spawn-callback',
                        callbackId: command.callbackId,
                        object: object.toLiteralContext(),
                        sender: sender.toLiteralContext(),
                        senderEndpoint: senderEndpoint
                    }

                    this.streamedReplyCb(msg);
                }

                this.spawnCallbacks.set(command.callbackId, cb);
            }

            const receiver = HashedObject.fromLiteralContext(command.receiver) as Identity;

            receiver.addKeyPair(HashedObject.fromLiteralContext(command.receiverKeyPair) as RSAKeyPair);
            
            this.mesh.addObjectSpawnCallback(cb, receiver, command.linkupServers, command.spawnId);

        } else if (command.type === 'send-object-spawn-callback') {

            const object   = HashedObject.fromLiteralContext(command.object);
            const receiver = HashedObject.fromLiteralContext(command.receiver) as Identity;
            const sender   = HashedObject.fromLiteralContext(command.sender) as Identity;

            sender.addKeyPair(HashedObject.fromLiteralContext(command.senderKeyPair) as RSAKeyPair);
            
            this.mesh.sendObjectSpawnRequest(object, sender, receiver, command.senderEndpoint, command.receiverLinkupServers, command.spawnId);

        } else if (command.type === 'shutdown') {
            this.mesh.shutdown();
        } else if (command.type === 'forward-get-peers-reply') {

            const reply = command as ForwardGetPeersReply;

            let ex = this.pendingPeersRequests.get(reply.requestId);

            if (ex !== undefined) {
                if (reply.error) {
                    ex.reject('Received rejection through remoting');
                } else {
                    ex.resolve(reply.peers.map((pi: {endpoint: Endpoint, identityHash: Hash, identity?: LiteralContext}) => {

                        const identity = (pi.identity === undefined? undefined : HashedObject.fromLiteralContext(pi.identity) as Identity)

                        return {endpoint: pi.endpoint, identityHash: pi.identityHash, identity: identity};
                    }));
                }
            }
        } else if (command.type === 'forward-get-peer-for-endpoint-reply') {

            const reply = command as ForwardGetPeerForEndpointReply;

            let ex = this.pendingPeerForEndpointRequests.get(reply.requestId);

            if (ex !== undefined) {
                if (reply.error) {
                    ex.reject('Received rejection through remoting');
                } else {

                    let peerInfo: PeerInfo | undefined = undefined;

                    if (reply.peerInfoContext !== undefined) {
                        peerInfo = { 
                            endpoint: reply.peerInfoContext.endpoint, 
                            identityHash: reply.peerInfoContext.identityHash
                        };

                        if (reply.peerInfoContext.identity !== undefined) {
                            const identity = HashedObject.fromLiteralContext(reply.peerInfoContext.identity);

                            if (!(identity instanceof Identity)) {
                                ex.reject('Received an invalid identity through remoting');
                            } else {
                                peerInfo.identity = identity;
                            }
                        }
                    }

                    ex.resolve(peerInfo);
                }
            }
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
         JoinPeerGroup, LeavePeerGroup, ForwardPeerGroupState, 
         SyncObjectsWithPeerGroup, StopSyncObjectsWithPeerGroup,
         StartObjectBroadcast, StopObjectBroadcast,
         FindObjectByHash, FindObjectByHashSuffix, AddObjectSpawnCallback, SendObjectSpawnRequest,
         Shutdown,
         CommandStreamedReply, LiteralObjectDiscoveryReply, DiscoveryEndReply, ObjectSpawnCallback, PeerGroupStateReply, LiteralPeerInfo, 
         ForwardGetPeersReply, ForwardGetPeerForEndpointReply,
         PeerSourceRequest, GetPeersRequest, GetPeerForEndpointRequest, PeerInfoContext };