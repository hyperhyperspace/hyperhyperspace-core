import { PeerGroupAgentConfig } from '../../agents/peer';
import { Mesh, PeerGroupInfo, SyncMode } from '../../service/Mesh';
import { Context, HashedObject } from 'data/model';
import { Hash } from 'data/model';
import { Endpoint } from 'mesh/agents/network';
import { AsyncStream } from 'util/streams';
import { ObjectDiscoveryReply } from 'mesh/agents/discovery';

type MeshCommand = JoinPeerGroup | CheckPeerGroupUsage | LeavePeerGroup |
                   SyncObjectsWithPeerGroup | StopSyncObjectsWithPeerGroup |
                   StartObjectBroadcast | StopObjectBroadcast |
                   FindObjectByHash | FindObjectByHashSuffix;

type JoinPeerGroup = {
    type: 'join-peer-group';
    peerGroupInfo: PeerGroupInfo;
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

    execute(command: MeshCommand) : void {

        //let error: string | undefined;

        if (command.type === 'join-peer-group') {
            const join = command as JoinPeerGroup;
            this.mesh.joinPeerGroup(join.peerGroupInfo, join.config);
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

            for (const hash of syncObjs.objContext.rootHashes) {
                objs.push(HashedObject.fromContext(syncObjs.objContext, hash));
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

            let obj = HashedObject.fromContext(startBcast.objContext);

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
                                streamId: streamId as string,
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
        }
    }

}

export { MeshServer, MeshCommand,
         JoinPeerGroup, CheckPeerGroupUsage, LeavePeerGroup,
         SyncObjectsWithPeerGroup, StopSyncObjectsWithPeerGroup,
         StartObjectBroadcast, StopObjectBroadcast,
         FindObjectByHash, FindObjectByHashSuffix,
         CommandStreamedReply, LiteralObjectDiscoveryReply, DiscoveryEndReply };