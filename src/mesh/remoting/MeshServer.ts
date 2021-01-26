import { PeerGroupAgentConfig } from '../agents/peer';
import { PeerGroupInfo } from '../service/Mesh';
import { Context } from 'data/model';

type MeshCommand = JoinPeerGroupCommand | CheckPeerGroupUsageCommand | LeavePeerGroupCommand |
                   SyncObjectWithPeerGroup;

type JoinPeerGroupCommand = {
    type: 'join-peer-group';
    peerGroupInfo: PeerGroupInfo;
    config?: PeerGroupAgentConfig;
};

type CheckPeerGroupUsageCommand = {
    type: 'check-peer-group-usage';
    peerGroupId: string;
    gossipId?: string;
}

type LeavePeerGroupCommand = {
    type: 'leave-peer-group';
    peerGroupId: string;
}

type SyncObjectWithPeerGroup = {
    type: 'sync-object-with-peer-group';
    peerGroupId: string;
    objContext: Context;
}

class MeshServer {

}

export { MeshServer };