
import { HashedObject } from 'data/model';
import { ObjectDiscoveryPeerSource, PeerInfo } from 'mesh/agents/peer';
import { Resources } from 'spaces/spaces';
import { PeerGroupInfo, SyncMode } from './Mesh';


class PeerNode {

    resources: Resources;

    constructor(resources: Resources) {
        this.resources = resources;
    }

    async broadcast(obj: HashedObject, linkupServers?: Array<string>, localEndpoints?: Array<string>): Promise<void> {

        if (linkupServers === undefined) {
            linkupServers = this.resources.config.linkupServers;
        }

        if (localEndpoints === undefined) {
            localEndpoints = this.resources.getPeersForDiscovery().map((pi:PeerInfo) => pi.endpoint);
        }

        this.resources.mesh.startObjectBroadcast(obj, linkupServers, localEndpoints);
    }

    async sync(obj: HashedObject, mode:SyncMode = SyncMode.full, peerGroup?: PeerGroupInfo, gossipId?: string): Promise<void> {

        if (peerGroup === undefined) {
            peerGroup = await this.discoveryPeerGroupInfo(obj);
        }

        this.resources.mesh.joinPeerGroup(peerGroup);
        this.resources.mesh.syncObjectWithPeerGroup(peerGroup.id, obj, mode, gossipId);
    }

    async stopSync(obj: HashedObject, peerGroupId?: string, gossipId?: string) : Promise<void> {
        if (peerGroupId === undefined) {
            peerGroupId = PeerNode.discoveryPeerGroupInfoId(obj);
        }
        this.resources.mesh.stopSyncObjectWithPeerGroup(peerGroupId, obj.hash(), gossipId);        

        if (!this.resources.mesh.isPeerGroupInUse(peerGroupId, gossipId)) {
            this.resources.mesh.leavePeerGroup(peerGroupId);
        }

    }

    async stopBroadcast(obj: HashedObject) {
        this.resources.mesh.stopObjectBroadcast(obj.hash());
    }

    private async discoveryPeerGroupInfo(obj: HashedObject) : Promise<PeerGroupInfo> {
        let localPeer = this.resources.getPeersForDiscovery()[0];
        let peerSource = new ObjectDiscoveryPeerSource(this.resources.mesh, obj, this.resources.config.linkupServers, localPeer.endpoint, this.resources.getEndointParserForDiscovery());

        return {
            id: PeerNode.discoveryPeerGroupInfoId(obj),
            localPeer: localPeer,
            peerSource: peerSource
        };

    }

    private static discoveryPeerGroupInfoId(obj: HashedObject) {
        return  'sync-for-' + obj.hash();
    }

}

export { PeerNode }