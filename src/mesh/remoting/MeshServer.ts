import { PeerGroupAgentConfig } from '../agents/peer';
import { Mesh, PeerGroupInfo, SyncMode } from '../service/Mesh';
import { Context, HashedObject } from 'data/model';
import { Hash } from 'data/model';
import { Endpoint } from 'mesh/agents/network';
import { RNGImpl } from 'crypto/random';
import { AsyncStream } from 'util/streams';
import { ObjectDiscoveryReply } from 'mesh/agents/discovery';

type MeshCommand = JoinPeerGroup | CheckPeerGroupUsageCommand | LeavePeerGroup |
                   SyncObjectsWithPeerGroup | StopSyncObjectsWithPeerGroup |
                   StartObjectBroadcast | StopObjectBroadcast |
                   FindObjectByHash | FindObjectByHashSuffix;

type JoinPeerGroup = {
    type: 'join-peer-group';
    peerGroupInfo: PeerGroupInfo;
    config?: PeerGroupAgentConfig;
};

type CheckPeerGroupUsageCommand = {
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
    objContext: Context;
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
    objContext: Context;
    linkupServers: Array<string>;
    replyEndpoints: Array<Endpoint>;
    brpadcastedSuffixBits?: number;
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
}

type CommandResult = { error?: string; streamedResponseId?: string };

type LiteralObjectDiscoveryReply = {
    type: 'object-discovery-reply'
    streamId: string;
    source: Endpoint, 
    destination: Endpoint, 
    hash: Hash, 
    objContext: Context, 
    timestamp: number
};

type DiscoveryEndReply = {
    type: 'object-discovery-end';
    streamId: string;
}

type CommandStreamedReply = LiteralObjectDiscoveryReply | DiscoveryEndReply;

class MeshServer {

    mesh: Mesh;
    streamedReplyCb: (resp: CommandStreamedReply) => void;

    constructor(mesh: Mesh, streamedReplyCb: (resp: CommandStreamedReply) => void) {
        this.mesh = mesh;
        this.streamedReplyCb = streamedReplyCb;
    }

    execute(command: MeshCommand) : CommandResult {

        //let error: string | undefined;

        let result: CommandResult = {};

        if (command.type === 'join-peer-group') {
            const join = command as JoinPeerGroup;

            try {
                this.mesh.joinPeerGroup(join.peerGroupInfo, join.config);
            } catch (e) {
                result.error = e;
            }
        } else if (command.type === 'leave-peer-group') {
            const leave = command as LeavePeerGroup;

            try {
                this.mesh.leavePeerGroup(leave.peerGroupId);
            } catch (e) {
                result.error = e;
            }
        } else if (command.type === 'sync-objects-with-peer-group') {
            const syncObjs = command as SyncObjectsWithPeerGroup;

            let objs: Array<HashedObject> = [];

            for (const hash of syncObjs.objContext.rootHashes) {
                objs.push(HashedObject.fromContext(syncObjs.objContext, hash));
            }
            
            try {
                this.mesh.syncManyObjectsWithPeerGroup(
                    syncObjs.peerGroupId, objs.values(), syncObjs.mode, syncObjs.gossipId
                );
            } catch (e) {
                result.error = e;
            }
        } else if (command.type === 'stop-sync-objects-with-peer-group') {
            const stopSyncObjs = command as StopSyncObjectsWithPeerGroup;

            try {
                this.mesh.stopSyncManyObjectsWithPeerGroup(
                    stopSyncObjs.peerGroupId, stopSyncObjs.hashes.values(), stopSyncObjs.gossipId
                );
            } catch (e) {
                result.error = e;
            }
        } else if (command.type === 'start-object-broadcast') {
            const startBcast = command as StartObjectBroadcast;

            let obj = HashedObject.fromContext(startBcast.objContext);

            try {
                this.mesh.startObjectBroadcast(obj, startBcast.linkupServers, startBcast.replyEndpoints, startBcast.brpadcastedSuffixBits
            );
            } catch (e) {
                result.error = e;
            }
        } else if (command.type === 'stop-object-broadcast') {
            const stopBcast = command as StopObjectBroadcast;

            try {
                this.mesh.stopObjectBroadcast(stopBcast.hash, stopBcast.broadcastedSuffixBits);
            } catch (e) {
                result.error = e;
            }
        } else if (command.type === 'find-object-by-hash' ||
                   command.type === 'find-object-by-hash-suffix') {
            const find = command as FindObjectByHash | FindObjectByHashSuffix;

            try {
                if (!find.retry) {

                    const streamId = new RNGImpl().randomHexString(64);
                    let replyStream: AsyncStream<ObjectDiscoveryReply>;

                    if (command.type === 'find-object-by-hash') {
                        replyStream = this.mesh.findObjectByHash(
                            (find as FindObjectByHash).hash, find.linkupServers, find.replyEndpoint, find.count, find.maxAge, find.strictEndpoints
                        );
                    } else {
                        this.mesh.findObjectByHashSuffix(
                            (find as FindObjectByHashSuffix).hashSuffix, find.linkupServers, find.replyEndpoint, find.count, find.maxAge, find.strictEndpoints
                        );
                    }
                    

                    const tt = setTimeout(async () => {

                        try {
                            while (!replyStream.atEnd()) {
                                const discov = await replyStream.next();

                                let reply: LiteralObjectDiscoveryReply = {
                                    type: 'object-discovery-reply',
                                    streamId: streamId,
                                    source: discov.source, 
                                    destination: discov.destination,
                                    hash: discov.hash, 
                                    objContext: discov.object.toContext(), 
                                    timestamp: discov.timestamp
                                };

                                this.streamedReplyCb(reply)

                            }


                        } finally {
                            let replyEnd: DiscoveryEndReply = {
                                type: 'object-discovery-end',
                                streamId: streamId
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
                
            } catch (e) {
                result.error = e;
            }
        }

        return result;
    }

}

export { MeshServer };