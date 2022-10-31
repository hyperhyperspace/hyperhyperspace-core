
import { Identity } from 'data/identity';
import { Hash, HashedObject } from 'data/model';
import { Endpoint } from 'mesh/agents/network';
import { ObjectDiscoveryPeerSource, PeerGroupState, PeerInfo } from 'mesh/agents/peer';
import { ObjectSpawnAgent, SpawnCallback } from 'mesh/agents/spawn';
import { LinkupAddress, LinkupManager } from 'net/linkup';
import { Resources } from 'spaces/spaces';
import { MultiMap } from 'util/multimap';
import { PeerGroupInfo, SyncMode, UsageToken } from './Mesh';

type Key = string;

class MeshNode {

    resources: Resources;

    peerGroupTokens: Map<Key, UsageToken>;
    syncTokens:      Map<Key, UsageToken>;
    broadcastTokens: Map<Key, UsageToken>;

    syncPerPeerGroup: MultiMap<UsageToken, UsageToken>;
    

    constructor(resources: Resources) {
        this.resources = resources;

        this.peerGroupTokens = new Map();
        this.syncTokens      = new Map();
        this.broadcastTokens = new Map();
        
        this.syncPerPeerGroup = new MultiMap();

    }

    async broadcast(obj: HashedObject, linkupServers?: Array<string>, localEndpoints?: Array<string>, broadcastedSuffixBits?: number): Promise<void> {

        if (linkupServers === undefined) {
            linkupServers = this.resources.config.linkupServers;
        }

        if (localEndpoints === undefined) {
            localEndpoints = this.resources.getPeersForDiscovery().map((pi:PeerInfo) => pi.endpoint);
        }

        const token = this.resources.mesh.startObjectBroadcast(obj, linkupServers, localEndpoints, broadcastedSuffixBits);

        this.broadcastTokens.set(obj.getLastHash(), token);
    }

    async stopBroadcast(obj: HashedObject) {

        const token = this.broadcastTokens.get(obj.hash());

        if (token !== undefined) {
            this.resources.mesh.stopObjectBroadcast(token);
            this.broadcastTokens.delete(obj.getLastHash());
        }
        
    }

    async getPeerGroupState(peerGroupId: string): Promise<PeerGroupState|undefined> {
        return this.resources.mesh.getPeerGroupState(peerGroupId);
    }

    async getPeerGroupStateForSyncObj(obj: HashedObject) {
        const peerGroup = await this.discoveryPeerGroupInfo(obj);

        return this.getPeerGroupState(peerGroup.id);
    }

    async sync(obj: HashedObject, mode :SyncMode = SyncMode.full, peerGroup?: PeerGroupInfo): Promise<void> {

        if (peerGroup === undefined) {
            peerGroup = await this.discoveryPeerGroupInfo(obj);
        }

        const peerGroupKey = MeshNode.generateKey([peerGroup.id]);

        let peerGroupToken = this.peerGroupTokens.get(peerGroupKey);
        
        if (peerGroupToken === undefined) {
            peerGroupToken = this.resources.mesh.joinPeerGroup(peerGroup);
            this.peerGroupTokens.set(peerGroupKey, peerGroupToken);
        }

        const syncKey = MeshNode.generateKey([obj.hash(), peerGroup.id]);

        let syncToken = this.syncTokens.get(syncKey);

        if (syncToken === undefined) {
            syncToken = this.resources.mesh.syncObjectWithPeerGroup(peerGroup.id, obj, mode);
            this.syncTokens.set(syncKey, syncToken);
            this.syncPerPeerGroup.add(peerGroupToken, syncToken);
        }
    }

    async stopSync(obj: HashedObject, peerGroupId?: string, gossipId?: string) : Promise<void> {
        if (peerGroupId === undefined) {
            peerGroupId = MeshNode.discoveryPeerGroupInfoId(obj);
        }

        const syncKey   = MeshNode.generateKey([obj.hash(), peerGroupId, gossipId]);
        const syncToken = this.syncTokens.get(syncKey);

        if (syncToken !== undefined) {

            this.resources.mesh.stopSyncObjectWithPeerGroup(syncToken);
            this.syncTokens.delete(syncKey);

            const peerGroupKey   = MeshNode.generateKey([peerGroupId]);
            const peerGroupToken = this.peerGroupTokens.get(peerGroupKey)

            if (peerGroupToken !== undefined) {
                this.syncPerPeerGroup.delete(peerGroupToken, syncToken);
                if (this.syncPerPeerGroup.get(peerGroupToken).size === 0) {
                    this.resources.mesh.leavePeerGroup(peerGroupToken);
                    this.peerGroupTokens.delete(peerGroupKey);
                }
            }
        }
    }

    addObjectSpawnCallback(callback: SpawnCallback, receiver: Identity, linkupServers=this.resources.config.linkupServers, spawnId=ObjectSpawnAgent.defaultSpawnId) {
        this.resources.mesh.addObjectSpawnCallback(callback, receiver, linkupServers, spawnId);
    }

    sendObjectSpawnRequest(object: HashedObject, sender: Identity, receiver: Identity, senderEndpoint: Endpoint = new LinkupAddress(LinkupManager.defaultLinkupServer, LinkupAddress.undisclosedLinkupId).url(), receiverLinkupServers=this.resources.config.linkupServers, spawnId=ObjectSpawnAgent.defaultSpawnId) {
        this.resources.mesh.sendObjectSpawnRequest(object, sender, receiver, senderEndpoint, receiverLinkupServers, spawnId)
    }

    private async discoveryPeerGroupInfo(obj: HashedObject) : Promise<PeerGroupInfo> {
        let localPeer = this.resources.getPeersForDiscovery()[0];
        let peerSource = new ObjectDiscoveryPeerSource(this.resources.mesh, obj, this.resources.config.linkupServers, LinkupAddress.fromURL(localPeer.endpoint, localPeer.identity), this.resources.getEndointParserForDiscovery());

        return {
            id: MeshNode.discoveryPeerGroupInfoId(obj),
            localPeer: localPeer,
            peerSource: peerSource
        };

    }

    private static discoveryPeerGroupInfoId(obj: HashedObject) {
        return  'sync-for-' + obj.hash();
    }

    private static generateKey(parts: (string|undefined)[]): string {

        let result = '';

        for (const part of parts) {
            if (part !== undefined) {
                if (result.length > 0) {
                    result = result + '-';
                }
                result = result + part.replace(/[-]/g, '--');
            }
        }

        return result;
    }

    async expectingMoreOps(obj: HashedObject, receivedOps?: Set<Hash>, peerGroupId?: string, rootObject?: HashedObject): Promise<boolean> {

        if (peerGroupId === undefined) {
            const peerGroup = await this.discoveryPeerGroupInfo(rootObject !== undefined? rootObject : obj);
            peerGroupId = peerGroup.id;
        }

        let syncAgent = this.resources.mesh.getSyncAgentFor(peerGroupId, obj.hash());

        if (syncAgent === undefined) {
            return false;
        } else {
            return syncAgent.expectingMoreOps(receivedOps);
        }
    }

}

export { MeshNode }