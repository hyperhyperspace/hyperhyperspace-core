import { Identity } from 'data/identity';
import { HashedObject } from 'data/model';
import { IdentityPeer, ObjectDiscoveryPeerSource, PeerInfo } from 'mesh/agents/peer';
import { LinkupManager } from 'net/linkup';
import { Store } from 'storage/store';
import { PeerGroupInfo, Mesh, SyncMode } from './Mesh';


class PeerNode {

    localIdentity: Identity;
    linkupServer: string;

    localPeerPromise: Promise<PeerInfo>;

    store: Store;
    mesh: Mesh;

    

    constructor(localIdentity: Identity, store: Store, mesh?: Mesh, linkupServer=LinkupManager.defaultLinkupServer) {
        

        this.localIdentity = localIdentity;
        this.linkupServer = linkupServer;

        this.localPeerPromise = (new IdentityPeer(this.linkupServer, this.localIdentity.hash(), this.localIdentity)).asPeer();

        this.store = store;
        this.mesh = mesh === undefined? new Mesh() : mesh;

    }

    async broadcast(obj: HashedObject, linkupServers=[this.linkupServer], localEndpoints?: Array<string>): Promise<void> {

        if (localEndpoints === undefined) {
            localEndpoints = [(await this.localPeerPromise).endpoint];
        }
        this.mesh.startObjectBroadcast(obj, linkupServers, localEndpoints);
    }

    async sync(obj: HashedObject, mode:SyncMode = SyncMode.full, peerGroup?: PeerGroupInfo, gossipId?: string): Promise<void> {

        if (peerGroup === undefined) {
            peerGroup = await this.discoveryPeerGroupInfo(obj);
        }

        this.mesh.joinPeerGroup(peerGroup);
        this.mesh.syncObjectWithPeerGroup(peerGroup.id, obj, mode, gossipId);
    }

    async stopSync(obj: HashedObject, peerGroupId?: string, gossipId?: string) : Promise<void> {
        if (peerGroupId === undefined) {
            peerGroupId = PeerNode.discoveryPeerGroupInfoId(obj);
        }
        this.mesh.stopSyncObjectWithPeerGroup(peerGroupId, obj.hash(), gossipId);        

        if (!this.mesh.isPeerGroupInUse(peerGroupId, gossipId)) {
            this.mesh.leavePeerGroup(peerGroupId);
        }

    }

    async stopBroadcast(obj: HashedObject) {
        this.mesh.stopObjectBroadcast(obj.hash());
    }

    private async discoveryPeerGroupInfo(obj: HashedObject) : Promise<PeerGroupInfo> {
        let localPeer = await this.localPeerPromise;
        let peerSource = new ObjectDiscoveryPeerSource(this.mesh, obj, [this.linkupServer], localPeer.endpoint, IdentityPeer.getEndpointParser(this.store));

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