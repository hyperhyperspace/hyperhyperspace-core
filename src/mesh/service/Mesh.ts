import { MutableObject, HashedObject, Hash, MutationOp, Hashing } from 'data/model';
import { Store } from 'storage/store';

import { MultiMap } from 'util/multimap';

import { Endpoint, NetworkAgent, SecureNetworkAgent } from '../agents/network';
import { PeerInfo, PeerSource, PeerGroupAgent, PeerGroupAgentConfig } from '../agents/peer';
import { StateGossipAgent, StateSyncAgent } from 'mesh/agents/state';
import { ObjectBroadcastAgent, ObjectDiscoveryAgent, ObjectDiscoveryReply, ObjectDiscoveryReplyParams } from '../agents/discovery';

import { AgentPod } from './AgentPod';
import { AsyncStream } from 'util/streams';




/* Connect to the Hyper Hyper Space service mesh.
 *
 *
 * Peers
 * =====
 *
 * A Peer on the mesh has an endpoint and a cryptographic identifier.
 * 
 * Endpoints can be either plain websocket listeners of the form
 *  - ws[s]://host/linkupId
 * where the peer is listening directly, or of the form
 *  - wrtc+ws[s]://host/linkupId
 * in which case 'host' is a Linkup Server (see LinkupManager class, a small stateless
 * support server that enables WebRTC connections and helps a bit with peer discovery),
 * and linkupId is a string identifying this peer.
 * 
 * In both direct WebSocket and WebRTC connection enabled by a Linkup Server, the
 * 'linkupId' part of the endpoint needs to allow establishing the cryptographic
 * identity of the peer. This can be done by any means (e.g. using a hash of the keypair, 
 * such hash obscured by symmetric encryption, a reference to some shared data both 
 * peers have, whatever).
 *
 *  
 * PeerGroups
 * ==========
 * Peers on the mesh organize in PeerGroups. See:
 *  - Mesh.joinPeerGroup(), Mesh.leavePeerGroup()
 * 
 * When joining, you need to specify the local peer, and a way to find peers to connect
 * to. This is done through the PeerSource interface, and can be a static list of peers
 * (similar to a .torrent file), peers discovered on the fly with help from one or many
 * Linkup Servers, or peers lifted from data that is being synchronized using the Mesh.
 * 
 * Once joined, PeerGroups can be used to synchronize HashedObjects and MutableObjects
 * (as defined in data/model). See:
 * 
 *  - Mesh.syncObjectWithPeerGroup(), Mesh.stopSyncObjectWithPeerGroup()
 *  - Mesh.syncManyObjectsWithPeerGroup(), Mesh.stopSyncManyObjectsWithPeerGroup()
 * 
 * 
 * Discovery
 * =========
 * 
 * Linkup Servers can be used as a basic discovery mechanism.
 * 
 *  - Mesh.startObjectBroadcast(), Mesh.stopObjectBroadcast()
 *  - Mesh.findObjectByHash(), Mesh.findObjectByHashRetry()
 *  - Mesh.findObjectByHashSuffix(), Mesh.findObjectByHashSuffixRetry()
 * 
 */ 



type GossipId  = string;
type PeerGroupId = string;
type PeerGroupInfo = { id: string, localPeer: PeerInfo, peerSource: PeerSource };

enum SyncMode {
    single    = 'single',     // just sync one object
    full      = 'full',       // sync the object, and any mutable object referenced by it (possibly indirectly).
    recursive = 'recursive'   // sync the object, and any mutable object referenced by it or its mutation ops.
}

class Mesh {

    pod: AgentPod;

    network: NetworkAgent;
    secured: SecureNetworkAgent;


    // for each peer group, all the gossip ids we have created.
    gossipIdsPerPeerGroup: MultiMap<string, GossipId>;

    syncAgents: Map<PeerGroupId, Map<Hash, StateSyncAgent>>;

    // for each gossip id, all the objects we've been explicitly asked to sync, and with which mode.
    rootObjects: Map<GossipId, Map<Hash, SyncMode>>;
    rootObjectStores: Map<GossipId, Map<Hash, Store>>;

    // given an object, all the gossip ids that are following it.
    gossipIdsPerObject: MultiMap<Hash, GossipId>;

    // keep track of callbacks for ALL objects we're monitoring (for recursive sync)
    allNewOpCallbacks: Map<GossipId, Map<Hash, (opHash: Hash)  => Promise<void>>>;

    // given an object, all the root objects it is being sync'd after.
    allRootAncestors: Map<GossipId, MultiMap<Hash, Hash>>;

    // given a root object, ALL the mut. objects that are being sync'd because of it.
    allDependencyClosures: Map<GossipId, MultiMap<Hash, Hash>>;

    // configuration


    constructor() {
        this.pod = new AgentPod();

        this.network = new NetworkAgent();
        this.pod.registerAgent(this.network);
        this.secured = new SecureNetworkAgent();
        this.pod.registerAgent(this.secured);

        this.gossipIdsPerPeerGroup = new MultiMap();

        this.syncAgents         = new Map();

        this.rootObjects        = new Map();
        this.rootObjectStores   = new Map();

        this.gossipIdsPerObject = new MultiMap();

        this.allNewOpCallbacks     = new Map()
        this.allRootAncestors      = new Map();
        this.allDependencyClosures = new Map();
        
    }

    // PeerGroups: join, leave

    joinPeerGroup(pg: PeerGroupInfo, config?: PeerGroupAgentConfig) {

        let agent = this.pod.getAgent(PeerGroupAgent.agentIdForPeerGroup(pg.id));

        if (agent === undefined) {
            agent = new PeerGroupAgent(pg.id, pg.localPeer, pg.peerSource, config);
            this.pod.registerAgent(agent);
        }

    }

    // FIXME: that would fail if the same peer group is used with
    //        more than one gossip ids.
    isPeerGroupInUse(peerGroupId: string, gossipId?: string) {

        if (gossipId === undefined) {
            gossipId = peerGroupId;
        }

        let roots = this.rootObjects.get(gossipId);

        return (roots !== undefined && roots.size > 0);

    }

    leavePeerGroup(peerGroupId: string) {

        const gossipIds = this.gossipIdsPerPeerGroup.get(peerGroupId);

        if (gossipIds !== undefined) {
            for (const gossipId of gossipIds) {
                const roots = this.rootObjects.get(gossipId);
                if (roots !== undefined) {
                    for (const hash of roots.keys()) {
                        this.stopSyncObjectWithPeerGroup(peerGroupId, hash, gossipId);
                    }
                }
                
            }
        }

        let agent = this.pod.getAgent(PeerGroupAgent.agentIdForPeerGroup(peerGroupId));

        if (agent !== undefined) {
            this.pod.deregisterAgent(agent);
        }
    }
        
    // Object synchronization

    syncObjectWithPeerGroup(peerGroupId: string, obj: HashedObject, mode:SyncMode=SyncMode.full, gossipId?: string) {
        
        let peerGroup = this.pod.getAgent(PeerGroupAgent.agentIdForPeerGroup(peerGroupId)) as PeerGroupAgent | undefined;
        if (peerGroup === undefined) {
            throw new Error("Cannot sync object with mesh " + peerGroupId + ", need to join it first.");
        }

        if (gossipId === undefined) {
            gossipId = peerGroupId;
        }

        let gossip = this.pod.getAgent(StateGossipAgent.agentIdForGossip(gossipId)) as StateGossipAgent | undefined;
        if (gossip === undefined) {
            gossip = new StateGossipAgent(gossipId, peerGroup);
            this.pod.registerAgent(gossip);
        } else if (gossip.getPeerControl().peerGroupId !== peerGroupId) {
            throw new Error('The gossip id ' + gossipId + ' is already in use buy peer group ' + gossip.getPeerControl().peerGroupId);
        }
        
        this.addRootSync(gossip, obj, mode);

        this.gossipIdsPerPeerGroup.add(peerGroupId, gossipId);
    }
        
    syncManyObjectsWithPeerGroup(peerGroupId: string, objs: IterableIterator<HashedObject>, mode:SyncMode=SyncMode.full, gossipId?: string) {
        
        for (const obj of objs) {
            this.syncObjectWithPeerGroup(peerGroupId, obj, mode, gossipId);
        }

    }

    stopSyncObjectWithPeerGroup(peerGroupId: string, hash: Hash, gossipId?: string) {

        if (gossipId === undefined) {
            gossipId = peerGroupId;
        }

        let gossip = this.pod.getAgent(StateGossipAgent.agentIdForGossip(gossipId)) as StateGossipAgent | undefined;

        if (gossip !== undefined) {
            this.removeRootSync(gossip, hash);

            let roots = this.rootObjects.get(gossipId);

            if (roots === undefined || roots.size === 0) {
                this.pod.deregisterAgent(gossip);
                this.gossipIdsPerPeerGroup.delete(peerGroupId, gossipId);
            }
        }


    }

    stopSyncManyObjectsWithPeerGroup(peerGroupId: string, hashes: IterableIterator<Hash>, gossipId?: string) {
        
        for (const hash of hashes) {
            this.stopSyncObjectWithPeerGroup(peerGroupId, hash, gossipId);
        }

    }

    // Object discovery

    startObjectBroadcast(object: HashedObject, linkupServers: string[], replyEndpoints: Endpoint[], broadcastedSuffixBits?: number) {

        const agentId = ObjectBroadcastAgent.agentIdForHash(object.hash(), broadcastedSuffixBits);
        let broadcastAgent = this.pod.getAgent(agentId) as ObjectBroadcastAgent;
        if (broadcastAgent === undefined) {
            broadcastAgent = new ObjectBroadcastAgent(object, broadcastedSuffixBits);
            this.pod.registerAgent(broadcastAgent);
        }

        broadcastAgent.listenOn(linkupServers, replyEndpoints);

    }

    stopObjectBroadcast(hash: Hash, broadcastedSuffixBits?: number) {
        const agentId = ObjectBroadcastAgent.agentIdForHash(hash, broadcastedSuffixBits);
        let broadcastAgent = this.pod.getAgent(agentId);
        broadcastAgent?.shutdown();
    }

    findObjectByHash(hash: Hash, linkupServers: string[], replyEndpoint: Endpoint, count=1, maxAge=30, strictEndpoints=false) : AsyncStream<ObjectDiscoveryReply> {
        const suffix = Hashing.toHex(hash);
        return this.findObjectByHashSuffix(suffix, linkupServers, replyEndpoint, count, maxAge, strictEndpoints);
    }

    findObjectByHashSuffix(hashSuffix: string, linkupServers: string[], replyEndpoint: Endpoint, count=1, maxAge=30, strictEndpoints=false) : AsyncStream<ObjectDiscoveryReply> {
        
        const discoveryAgent = this.getDiscoveryAgentFor(hashSuffix);

        discoveryAgent.query(linkupServers, replyEndpoint, count);

        let params: ObjectDiscoveryReplyParams = {};

        params.maxAge = maxAge;

        if (strictEndpoints) {
            params.linkupServers = linkupServers;
            params.localEndpoints = [replyEndpoint];
        }

        return discoveryAgent.getReplyStream(params);
    }

    findObjectByHashRetry(hash: Hash, linkupServers: string[], replyEndpoint: Endpoint, count=1): void {
        const suffix = Hashing.toHex(hash);
        this.findObjectByHashSuffixRetry(suffix, linkupServers, replyEndpoint, count);
    }

    findObjectByHashSuffixRetry(hashSuffix: string, linkupServers: string[], replyEndpoint: Endpoint, count=1): void {
        const discoveryAgent = this.getDiscoveryAgentFor(hashSuffix);
        discoveryAgent.query(linkupServers, replyEndpoint, count);
    }

    private getDiscoveryAgentFor(hashSuffix: string): ObjectDiscoveryAgent {
        const agentId = ObjectDiscoveryAgent.agentIdForHexHashSuffix(hashSuffix);

        let discoveryAgent = this.pod.getAgent(agentId) as ObjectDiscoveryAgent | undefined;

        if (discoveryAgent !== undefined && discoveryAgent.wasShutdown) {
            this.pod.deregisterAgent(discoveryAgent);
            discoveryAgent = undefined;
        }

        if (discoveryAgent === undefined) {
            discoveryAgent = new ObjectDiscoveryAgent(hashSuffix);
            this.pod.registerAgent(discoveryAgent);
        }

        return discoveryAgent;
    }

    private addRootSync(gossip: StateGossipAgent, obj: HashedObject, mode: SyncMode) {

        const gossipId = gossip.gossipId;

        let roots = this.rootObjects.get(gossipId)
        if (roots === undefined) {
            roots = new Map();
            this.rootObjects.set(gossipId, roots);
        }

        let rootStores = this.rootObjectStores.get(gossipId);
        if (rootStores === undefined) {
            rootStores = new Map();
            this.rootObjectStores.set(gossipId, rootStores);
        }

        let hash = obj.hash();
        let oldMode = roots.get(hash);


        if (oldMode === undefined) {
            roots.set(hash, mode);
            rootStores.set(hash, obj.getResources()?.store as Store);

            if (mode === SyncMode.single) {
                if (obj instanceof MutableObject) {
                    this.addSingleObjectSync(gossip, hash, obj);
                } else {
                    throw new Error('Asked to sync object in single mode, but it is not mutable, so there is nothing to do.');
                }
            } else {
                this.addFullObjectSync(gossip, obj, hash, mode);
            }

        } else if (oldMode !== mode) {

            throw new Error('The object ' + hash + ' was already being gossiped on ' + gossipId + ', but with a different mode. Gossiping with more than one mode is not supported.');
        }
    }

    private removeRootSync(gossip: StateGossipAgent, objHash: Hash) {

        let roots = this.rootObjects.get(gossip.gossipId);
        let rootStores = this.rootObjectStores.get(gossip.gossipId);
        

        if (roots !== undefined) {
            let oldMode = roots.get(objHash);
            
            if (oldMode !== undefined) {
                roots.delete(objHash);

                if (oldMode === SyncMode.single) {
                    let modes = this.getAllModesForObject(gossip, objHash);

                    if (modes.size === 0) {
                        this.removeSingleObjectSync(gossip, objHash);
                    }
                } else {
                    const store = rootStores?.get(objHash) as Store;
                    this.removeFullObjectSync(gossip, objHash, objHash, oldMode, store);
                }
                
            }
        }

    }

    // get all the modes this objHash is being synced within all gossip ids
    // that share their peer group with the provided one.

    private getAllModesForObject(gossip: StateGossipAgent, objHash: Hash) : Set<SyncMode> {

        let modes = new Set<SyncMode>();

        if (gossip !== undefined) {
            let peerGroupId = gossip.peerGroupAgent.peerGroupId;

            let matchGossipIds = this.gossipIdsPerPeerGroup.get(peerGroupId);

            if (matchGossipIds !== undefined) {
                for (const matchGossipId of matchGossipIds) {
                    let roots = this.rootObjects.get(matchGossipId);
                    let mode = roots?.get(objHash);
                    if (mode !== undefined) {
                        modes.add(mode);
                    }

                    let rootAncestors = this.allRootAncestors.get(matchGossipId)?.get(objHash);

                    if (rootAncestors !== undefined) {
                        for (const rootHash of rootAncestors) {
                            let rootMode = roots?.get(rootHash);
                            if (rootMode !== undefined) {
                                modes.add(rootMode);
                            }
                        }
                    } 
                }
            }

            return modes;
        }

        

        return modes;

    }

    private addFullObjectSync(gossip: StateGossipAgent, obj: HashedObject, root: Hash, mode: SyncMode) {

        const gossipId = gossip.gossipId;

        let hash = obj.hash();

        let dependencies = this.allDependencyClosures.get(gossipId);

        if (dependencies === undefined) {
            dependencies = new MultiMap();
            this.allDependencyClosures.set(gossipId, dependencies);
        }

        if (!dependencies.get(root).has(hash)) {
            

            let rootAncestors = this.allRootAncestors.get(gossipId);
    
            if (rootAncestors === undefined) {
                rootAncestors = new MultiMap();
                this.allRootAncestors.set(gossipId, rootAncestors);
            }

            let targets = new Map<Hash , MutableObject>();
    
            if (mode === SyncMode.single) {
                if (obj instanceof MutableObject) {
                    targets.set(hash, obj);
                }
            } else {

            // (mode === SyncMode.subobjects || mode === SyncMode.mutations)

                let context = obj.toContext();

                for (let [hash, dep] of context.objects.entries()) {
                    if (dep instanceof MutableObject) {
                        targets.set(hash, dep);
                    }
                }
            }
            
            for (const [thash, target] of targets.entries()) {

                this.addSingleObjectSync(gossip, thash, target);
                
                dependencies.add(root, thash);
                rootAncestors.add(thash, root);

                if (mode === SyncMode.recursive) {
                    this.watchForNewOps(gossip, target);
                    this.trackOps(gossip, target, root);
                }
            }
        }
    }

    private removeFullObjectSync(gossip: StateGossipAgent, mutHash: Hash, oldRootHash: Hash, oldMode: SyncMode, store: Store) {
        
        let depClosures = this.allDependencyClosures.get(gossip.gossipId);
        
        let depClosure = depClosures?.get(mutHash);

        if (depClosure !== undefined) {

            depClosures?.deleteKey(mutHash);

            for (const depHash of depClosure) {
                this.allRootAncestors.get(gossip.gossipId)?.delete(depHash, oldRootHash);
            }

            for (const depHash of depClosure) {
                const modes = this.getAllModesForObject(gossip, depHash);

                if (modes.size === 0) {
                    this.removeSingleObjectSync(gossip, depHash);
                }

                if (oldMode === SyncMode.recursive && !modes.has(SyncMode.recursive)) {
                    this.unwatchForNewOps(gossip, depHash, store);
                }
            }
        }
    }

    private addSingleObjectSync(gossip: StateGossipAgent, mutHash: Hash, mut: MutableObject) {

        const peerGroup = gossip.peerGroupAgent;
        const peerGroupId = peerGroup.peerGroupId;

        let peerGroupSyncAgents = this.syncAgents.get(peerGroupId);
        
        if (peerGroupSyncAgents === undefined) {
            peerGroupSyncAgents = new Map();
            this.syncAgents.set(peerGroupId, peerGroupSyncAgents);
        }

        let sync = peerGroupSyncAgents.get(mutHash);
    
        if (sync === undefined) {
            sync = mut.createSyncAgent(gossip.peerGroupAgent);
            this.pod.registerAgent(sync);
            peerGroupSyncAgents.set(mutHash, sync);
        }
    
        gossip.trackAgentState(sync.getAgentId());
    }

    private removeSingleObjectSync(gossip: StateGossipAgent, mutHash: Hash) {

        if (gossip !== undefined) {
            const peerGroup = gossip.peerGroupAgent;
            const peerGroupId = peerGroup.peerGroupId;
    
            let peerGroupSyncAgents = this.syncAgents.get(peerGroupId);
            let sync = peerGroupSyncAgents?.get(mutHash);
    
            if (sync !== undefined) {
                gossip.untrackAgentState(sync.getAgentId());
                this.pod.deregisterAgent(sync);
                peerGroupSyncAgents?.delete(mutHash);
            }
        }
    }


    // recursive tracking of subobjects for state gossip & sync


    // Fetch existing ops on the databse and check if there are any mutable
    // references to track.
    private async trackOps(gossip: StateGossipAgent, mut: MutableObject, root: Hash) {
        
        let validOpClasses = mut.getAcceptedMutationOpClasses();
        let refs = await mut.getStore().loadByReference('target', mut.hash());


        for (let obj of refs.objects) {

            if (validOpClasses.indexOf(obj.getClassName()) >= 0) {
                this.addFullObjectSync(gossip, mut, root, SyncMode.recursive); 
            }
        }
    }

    private watchForNewOps(gossip: StateGossipAgent, mut: MutableObject) {

        let newOpCallbacks = this.allNewOpCallbacks.get(gossip.gossipId);

        if (newOpCallbacks === undefined) {
            newOpCallbacks = new Map();
            this.allNewOpCallbacks.set(gossip.gossipId, newOpCallbacks);
        }

        let hash = mut.hash();

        if (!newOpCallbacks.has(hash)) {
            let callback = async (opHash: Hash) => {
                let op = await mut.getStore().load(opHash);
                if (op !== undefined && 
                    mut.getAcceptedMutationOpClasses().indexOf(op.getClassName()) >= 0) {
                        let mutOp = op as MutationOp;
                        const roots = this.allRootAncestors.get(gossip.gossipId)?.get(mutOp.getTarget().hash())

                        if (roots !== undefined) {
                            for (const rootHash of roots) {
                                if (this.rootObjects.get(gossip.gossipId)?.get(rootHash) === SyncMode.recursive) {
                                    this.addFullObjectSync(gossip, op, rootHash, SyncMode.recursive);
                                }
                            }
                        }
                        
                }
            };

            newOpCallbacks.set(hash, callback);

            mut.getStore().watchReferences('target', mut.hash(), callback);
        }
    }

    private unwatchForNewOps(gossip: StateGossipAgent, mutHash: Hash, store: Store) {
        let newOpCallbacks = this.allNewOpCallbacks.get(gossip.gossipId);

        const callback = newOpCallbacks?.get(mutHash);
        
        if (callback !== undefined) {
            store.removeReferencesWatch('target', mutHash, callback);
            newOpCallbacks?.delete(mutHash);
        }   
    }

}

export { Mesh, PeerGroupInfo, SyncMode }