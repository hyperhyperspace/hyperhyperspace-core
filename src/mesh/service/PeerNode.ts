import { Identity } from 'data/identity';
import { HashedObject, Resources } from 'data/model';
import { IdentityPeer, ObjectDiscoveryPeerSource, PeerInfo } from 'mesh/agents/peer';
import { LinkupManager } from 'net/linkup';
import { Store } from 'storage/store';
import { PeerGroupInfo, Mesh, SyncMode } from './Mesh';


class PeerNode {

    localIdentity: Identity;
    linkupServer: string;

    peerInfoPromise: Promise<PeerInfo>;

    store: Store;
    mesh: Mesh;

    

    constructor(resources: Partial<Resources>) {

        if (resources.config?.id === undefined) {
            throw new Error('Cannot start sync: local identity has not been defined.');
        }

        if (resources.store === undefined) {
            throw new Error('Cannot start sync: a local store has not been configured.')
        }

        this.localIdentity = resources.config.id as Identity;
        this.store = resources.store as Store;


        this.linkupServer = resources.config.linkupServers !== undefined && resources.config.linkupServers.length > 0?
                                resources.config.linkupServers[0] :
                                LinkupManager.defaultLinkupServer; 

        this.peerInfoPromise = (new IdentityPeer(this.linkupServer, this.localIdentity.hash(), this.localIdentity)).asPeer();

        this.mesh = resources.mesh !== undefined? 
                        resources.mesh : new Mesh();

    }

    async broadcast(obj: HashedObject, linkupServers=[this.linkupServer], localEndpoints?: Array<string>): Promise<void> {

        if (localEndpoints === undefined) {
            localEndpoints = [(await this.peerInfoPromise).endpoint];
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
        let localPeer = await this.peerInfoPromise;
        let peerSource = new ObjectDiscoveryPeerSource(this.mesh, obj, [this.linkupServer], localPeer.endpoint, IdentityPeer.getEndpointParser(this.store));

        return {
            id: PeerNode.discoveryPeerGroupInfoId(obj),
            localPeer: localPeer,
            peerSource: peerSource
        };

    }

    async getPeerInfo(): Promise<PeerInfo> {
        return this.peerInfoPromise;
    }

    private static discoveryPeerGroupInfoId(obj: HashedObject) {
        return  'sync-for-' + obj.hash();
    }

}

export { PeerNode }