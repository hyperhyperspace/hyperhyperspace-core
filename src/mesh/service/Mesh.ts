import { MutableObject, HashedObject, Hash, MutationOp, Hashing } from 'data/model';
import { Store } from 'storage/store';

import { MultiMap } from 'util/multimap';

import { Endpoint, NetworkAgent, NetworkAgentProxyConfig, SecureNetworkAgent } from '../agents/network';
import { PeerInfo, PeerSource, PeerGroupAgent, PeerGroupAgentConfig, ObjectDiscoveryPeerSource } from '../agents/peer';
import { StateGossipAgent, StateSyncAgent, SyncObserver, SyncObserverAgent, SyncState } from 'mesh/agents/state';
import { ObjectBroadcastAgent, ObjectDiscoveryAgent, ObjectDiscoveryReply, ObjectDiscoveryReplyParams } from '../agents/discovery';

import { AgentPod } from './AgentPod';
import { AsyncStream } from 'util/streams';
import { LinkupAddress, LinkupManager } from 'net/linkup';
import { RNGImpl } from 'crypto/random';
import { Logger, LogLevel } from 'util/logging';
import { Identity } from 'data/identity';
import { ObjectSpawnAgent, SpawnCallback } from 'mesh/agents/spawn/ObjectSpawnAgent';
import { ObjectInvokeAgent } from 'mesh/agents/spawn/ObjectInvokeAgent';
import { PeerGroupState } from 'mesh/agents/peer/PeerGroupState';
import { Resources } from 'spaces/Resources';
import { MeshInterface } from './remoting/MeshInterface';


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
 * 
 * Usage tokens
 * ============
 * 
 * Since several modules or applications may share a Mesh instance, in response to each 
 * acquired resource (a peer group being joined, an object synchronized or broadcasted)
 * the Mesh will return a UsageToken. The token needs to be produced to leave the peer 
 * group or to stop the sync/broadcasting of the object. The resource is effectively 
 * released when all the registered usage tokens are released.
 * 
 */ 


type PeerGroupId = string;
type PeerGroupInfo = { id: string, localPeer: PeerInfo, peerSource: PeerSource };

type UsageToken = string;

type PeerGroupUsageInfo       = { type: 'peer-group', peerGroupId: PeerGroupId };
type ObjectSyncUsageInfo      = { type: 'object-sync', peerGroupId: PeerGroupId, objHash: Hash };
type ObjectBroadcastUsageInfo = { type: 'object-broadcast', objHash: Hash, broadcastedSuffixBits: number }
type UsageInfo = PeerGroupUsageInfo | ObjectSyncUsageInfo | ObjectBroadcastUsageInfo;

type UsageKey = string;

enum SyncMode {
    single    = 'single',     // just sync one object
    full      = 'full',       // sync the object, and any mutable object referenced by it (possibly indirectly).
    recursive = 'recursive'   // sync the object, and any mutable object referenced by it or its mutation ops.
}

class CannotInferPeerGroup extends Error {
    constructor(mutHash: Hash) {
        super('The sync state for ' + mutHash + ' was requested, but no peerGroupId was specified, and there is not exactly one peer group synchronizing this object, so we cannot infer which one was intended!');
    }
}

class Mesh implements MeshInterface {

    static syncCommandsLog = new Logger('mesh-sync-commands', LogLevel.INFO);

    pod: AgentPod;

    network: NetworkAgent;
    secured: SecureNetworkAgent;
    syncObserver: SyncObserverAgent;

    usage: MultiMap<UsageKey, UsageToken>;
    usageTokens: Map<UsageToken, UsageInfo>;

    syncAgents: Map<PeerGroupId, Map<Hash, StateSyncAgent>>;

    // for each peer group, all the objects we've been explicitly asked to sync, and with which mode.
    rootObjects: Map<PeerGroupId, Map<Hash, SyncMode>>;
    rootObjectStores: Map<PeerGroupId, Map<Hash, Store>>;

    // given an object, all the peer groups that are following it.
    gossipIdsPerObject: MultiMap<Hash, PeerGroupId>;

    // keep track of callbacks for ALL objects we're monitoring (for recursive sync)
    allNewOpCallbacks: Map<PeerGroupId, Map<Hash, (opHash: Hash)  => Promise<void>>>;

    // given an object, all the root objects it is being sync'd after.
    allRootAncestors: Map<PeerGroupId, MultiMap<Hash, Hash>>;

    // given a root object, ALL the mut. objects that are being sync'd because of it.
    allDependencyClosures: Map<PeerGroupId, MultiMap<Hash, Hash>>;

    // configuration

    wasShutdown: boolean;


    constructor(networkProxy?: NetworkAgentProxyConfig) {
        this.pod = new AgentPod();

        this.network = new NetworkAgent(new LinkupManager(), networkProxy);
        this.pod.registerAgent(this.network);
        this.secured = new SecureNetworkAgent();
        this.pod.registerAgent(this.secured);
        this.syncObserver = new SyncObserverAgent();
        this.pod.registerAgent(this.syncObserver);

        this.usage = new MultiMap();
        this.usageTokens = new Map();

        this.syncAgents         = new Map();

        this.rootObjects        = new Map();
        this.rootObjectStores   = new Map();

        this.gossipIdsPerObject = new MultiMap();

        this.allNewOpCallbacks     = new Map()
        this.allRootAncestors      = new Map();
        this.allDependencyClosures = new Map();

        this.wasShutdown = false;
        
    }

    // PeerGroups: join, leave

    joinPeerGroup(pg: PeerGroupInfo, config?: PeerGroupAgentConfig, usageToken?: UsageToken): UsageToken {

        let token = this.registerUsage({type: 'peer-group', peerGroupId: pg.id}, usageToken);

        let agent = this.pod.getAgent(PeerGroupAgent.agentIdForPeerGroup(pg.id));

        if (agent === undefined) {
            agent = new PeerGroupAgent(pg.id, pg.localPeer, pg.peerSource, config);
            this.pod.registerAgent(agent);
        }

        return token;
    }

    leavePeerGroup(token: UsageToken) {

        const usageInfo = this.deregisterUsage(token, 'peer-group') as (PeerGroupUsageInfo | undefined);

        if (usageInfo !== undefined) {
            const usageKey  = Mesh.createUsageKey(usageInfo);

            if (this.usage.get(usageKey).size === 0) {

                const agentId = PeerGroupAgent.agentIdForPeerGroup(usageInfo.peerGroupId);
                
                let agent = this.pod.getAgent(agentId);

                if (agent !== undefined) {
                    this.pod.deregisterAgent(agent);
                }
            }

        }

    }

    async getPeerGroupState(peerGroupId: string): Promise<PeerGroupState|undefined> {

        const agentId = PeerGroupAgent.agentIdForPeerGroup(peerGroupId);

        const agent = this.pod.getAgent(agentId) as PeerGroupAgent;

        if (agent === undefined) {
            return undefined;
        } else {
            return agent.getState();
        }
    }

    /*getConnectedPeers(peerGroupId: string): Array<PeerInfo> {
        let agent = this.pod.getAgent(PeerGroupAgent.agentIdForPeerGroup(peerGroupId)) as PeerGroupAgent;

        if (agent === undefined) {
            return [];
        } else {
            return agent.getPeers();
        }
    }*/
        
    // Object synchronization

    syncObjectWithPeerGroup(peerGroupId: string, obj: HashedObject, mode:SyncMode=SyncMode.full, usageToken?: UsageToken): UsageToken {
        
        Mesh.syncCommandsLog.debug('requested sync of ' + obj.getLastHash() + ' with ' + peerGroupId + ' in mode ' + mode);

        let peerGroup = this.pod.getAgent(PeerGroupAgent.agentIdForPeerGroup(peerGroupId)) as PeerGroupAgent | undefined;
        if (peerGroup === undefined) {
            throw new Error("Cannot sync object with mesh " + peerGroupId + ", need to join it first.");
        }

        const gossipId = peerGroupId;

        let gossip = this.pod.getAgent(StateGossipAgent.agentIdForGossipId(gossipId)) as StateGossipAgent | undefined;
        if (gossip === undefined) {
            gossip = new StateGossipAgent(gossipId, peerGroup);
            this.pod.registerAgent(gossip);
        } else if (gossip.getPeerControl().peerGroupId !== peerGroupId) {
            throw new Error('The gossip id ' + gossipId + ' is already in use buy peer group ' + gossip.getPeerControl().peerGroupId);
        }
        
        this.addRootSync(gossip, obj, mode);

        return this.registerUsage({type: 'object-sync', objHash: obj.getLastHash(), peerGroupId: peerGroupId}, usageToken);
    }
    
    syncManyObjectsWithPeerGroup(peerGroupId: string, objs: IterableIterator<HashedObject>, mode:SyncMode=SyncMode.full, usageTokens?: Map<Hash, UsageToken>): Map<Hash, UsageToken> {
        
        const tokens = new Map<Hash, UsageToken>();

        for (const obj of objs) {
            const usageToken = this.syncObjectWithPeerGroup(peerGroupId, obj, mode, usageTokens?.get(obj.getLastHash()));
            tokens.set(obj.getLastHash(), usageToken);
        }

        return tokens;
    }

    stopSyncObjectWithPeerGroup(usageToken: UsageToken) {

        const usageInfo = this.deregisterUsage(usageToken, 'object-sync') as (ObjectSyncUsageInfo | undefined);

        if (usageInfo !== undefined) {

            const usageKey = Mesh.createUsageKey(usageInfo);

            if (this.usage.get(usageKey).size === 0) {
                
                const peerGroupId = usageInfo.peerGroupId;
                const hash        = usageInfo.objHash;

                Mesh.syncCommandsLog.debug('requested STOP sync of ' + hash + ' with ' + peerGroupId);
        
                let gossip = this.pod.getAgent(StateGossipAgent.agentIdForGossipId(peerGroupId)) as StateGossipAgent | undefined;
        
                if (gossip !== undefined) {
                    this.removeRootSync(gossip, hash);
        
                    let roots = this.rootObjects.get(peerGroupId);
        
                    if (roots === undefined || roots.size === 0) {
                        this.pod.deregisterAgent(gossip);
                    }
                }
            }
        }
        


    }

    stopSyncManyObjectsWithPeerGroup(tokens: IterableIterator<UsageToken>) {
        
        for (const token of tokens) {
            this.stopSyncObjectWithPeerGroup(token);
        }

    }

    async getSyncState(mut: MutableObject, peerGroupId?: PeerGroupId): Promise<SyncState|undefined> {

        if (peerGroupId === undefined) {
            peerGroupId = this.inferPeerGroupId(mut);
        }

        const syncAgent = this.pod.getAgent(mut.getSyncAgentId(peerGroupId)) as StateSyncAgent|undefined;

        if (syncAgent !== undefined) {
            return syncAgent.getSyncState();
        } else {
            return undefined;
        }
    }

    async addSyncObserver(obs: SyncObserver, mut: MutableObject, peerGroupId?: PeerGroupId) {

        if (peerGroupId === undefined) {
            peerGroupId = this.inferPeerGroupId(mut);
        }

        this.syncObserver.addSyncObserver(obs, mut, peerGroupId);
    }

    async removeSyncObserver(obs: SyncObserver, mut: MutableObject, peerGroupId?: PeerGroupId) {

        if (peerGroupId === undefined) {
            peerGroupId = this.inferPeerGroupId(mut);
        }

        this.syncObserver.removeSyncObserver(obs, mut, peerGroupId);
    }

    // Object discovery

    startObjectBroadcast(object: HashedObject, linkupServers: string[], replyEndpoints: Endpoint[], broadcastedSuffixBits?: number, usageToken?: UsageToken): UsageToken {

        if (broadcastedSuffixBits === undefined) {
            broadcastedSuffixBits = ObjectBroadcastAgent.defaultBroadcastedSuffixBits;
        }

        const agentId = ObjectBroadcastAgent.agentIdForHash(object.getLastHash(), broadcastedSuffixBits);
        let broadcastAgent = this.pod.getAgent(agentId) as ObjectBroadcastAgent;
        if (broadcastAgent === undefined) {
            broadcastAgent = new ObjectBroadcastAgent(object, broadcastedSuffixBits);
            this.pod.registerAgent(broadcastAgent);
        }

        broadcastAgent.listenOn(linkupServers, replyEndpoints);

        return this.registerUsage({type: 'object-broadcast', objHash: object.getLastHash(), broadcastedSuffixBits: broadcastedSuffixBits}, usageToken);
    }

    stopObjectBroadcast(token: UsageToken) {

        const usageInfo = this.deregisterUsage(token, 'object-broadcast') as (ObjectBroadcastUsageInfo | undefined);

        if (usageInfo !== undefined) {
            const usageKey = Mesh.createUsageKey(usageInfo);

            if (this.usage.get(usageKey).size === 0) {

                const hash = usageInfo.objHash;
                const broadcastedSuffixBits = usageInfo.broadcastedSuffixBits;

                const agentId = ObjectBroadcastAgent.agentIdForHash(hash, broadcastedSuffixBits);
                let broadcastAgent = this.pod.getAgent(agentId);
                broadcastAgent?.shutdown();
            }
        }
        
    }

    // FIXME: findObjectByHash uses an instance of ObjectDiscoveryAgent constructed without any config params.
    //        That fixes the number of bits used for discovery to 36, which is the default. This is particularily
    //        irksome in findObjectByHashSuffix, that does the same (one would expect it to use as many bits as
    //        are present in the received suffix!). To fix it, either change ObjectDiscoveryAgent to use all the
    //        received bits, or pass the number of bits explicitly when calling the constructor.

    findObjectByHash(hash: Hash, linkupServers: string[], replyAddress: LinkupAddress, count=1, maxAge=30, strictEndpoints=false, includeErrors=false) : AsyncStream<ObjectDiscoveryReply> {
        const suffix = Hashing.toHex(hash);
        return this.findObjectByHashSuffix(suffix, linkupServers, replyAddress, count, maxAge, strictEndpoints, includeErrors);
    }

    findObjectByHashSuffix(hashSuffix: string, linkupServers: string[], replyAddress: LinkupAddress, count=1, maxAge=30, strictEndpoints=false, includeErrors=false) : AsyncStream<ObjectDiscoveryReply> {
        
        const discoveryAgent = this.getDiscoveryAgentFor(hashSuffix);

        discoveryAgent.query(linkupServers, replyAddress, count);

        let params: ObjectDiscoveryReplyParams = {};

        params.maxAge = maxAge;

        if (strictEndpoints) {
            params.linkupServers = linkupServers;
            params.localEndpoints = [replyAddress.url()];
        }

        params.includeErrors = includeErrors;

        return discoveryAgent.getReplyStream(params);
    }

    findObjectByHashRetry(hash: Hash, linkupServers: string[], replyAddress: LinkupAddress, count=1): void {
        const suffix = Hashing.toHex(hash);
        this.findObjectByHashSuffixRetry(suffix, linkupServers, replyAddress, count);
    }

    findObjectByHashSuffixRetry(hashSuffix: string, linkupServers: string[], replyAddress: LinkupAddress, count=1): void {
        const discoveryAgent = this.getDiscoveryAgentFor(hashSuffix);
        discoveryAgent.query(linkupServers, replyAddress, count);
    }


    // object spawning

    addObjectSpawnCallback(callback: SpawnCallback, receiver: Identity, linkupServers: Array<string>, spawnId=ObjectSpawnAgent.defaultSpawnId) {
        const agentId = ObjectSpawnAgent.agentIdFor(receiver, spawnId);
        
        let objectSpawnAgent = this.pod.getAgent(agentId) as ObjectSpawnAgent;

        if (objectSpawnAgent === undefined) {
            objectSpawnAgent = new ObjectSpawnAgent(receiver, spawnId);
            this.pod.registerAgent(objectSpawnAgent);
        }

        objectSpawnAgent.addSpawnCallback(linkupServers, callback);
    }

    sendObjectSpawnRequest(object: HashedObject, sender: Identity, receiver: Identity, senderEndpoint: Endpoint = new LinkupAddress(LinkupManager.defaultLinkupServer, LinkupAddress.undisclosedLinkupId).url(), receiverLinkupServers: Array<string>, spawnId=ObjectSpawnAgent.defaultSpawnId) {
        const agentId = ObjectInvokeAgent.agentIdFor(sender, spawnId);

        let objectInvokeAgent = this.pod.getAgent(agentId) as ObjectInvokeAgent;

        if (objectInvokeAgent === undefined) {
            objectInvokeAgent = new ObjectInvokeAgent(sender, spawnId);
            this.pod.registerAgent(objectInvokeAgent);
        }

        objectInvokeAgent.sendRequest(object, receiver, receiverLinkupServers, senderEndpoint);
    }

    getSyncAgentFor(peerGroupId: PeerGroupId, mutHash: Hash): StateSyncAgent|undefined {
        return this.syncAgents.get(peerGroupId)?.get(mutHash);
    }

    shutdown() {
        this.wasShutdown = true;

        for (const agent of this.pod.agents.values()) {
            agent.shutdown();
        }
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

        let hash = obj.getLastHash();

        Mesh.syncCommandsLog.trace('adding root ' + hash);

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

        Mesh.syncCommandsLog.trace('removing root ' + objHash);

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

            let roots = this.rootObjects.get(peerGroupId);
            let mode = roots?.get(objHash);
            if (mode !== undefined) {
                modes.add(mode);
            }

            let rootAncestors = this.allRootAncestors.get(peerGroupId)?.get(objHash);

            if (rootAncestors !== undefined) {
                for (const rootHash of rootAncestors) {
                    let rootMode = roots?.get(rootHash);
                    if (rootMode !== undefined) {
                        modes.add(rootMode);
                    }
                }
            } 

            return modes;
        }

        

        return modes;

    }

    private addFullObjectSync(gossip: StateGossipAgent, obj: HashedObject, root: Hash, mode: SyncMode) {

        const gossipId = gossip.gossipId;

        let hash = obj.getLastHash();

        Mesh.syncCommandsLog.trace('adding full object sync for  ' + hash + '(a ' + obj.getClassName() + ')');

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

                Mesh.syncCommandsLog.trace('adding sync of subobject ' + thash + ' (a ' + target.getClassName() + ') of ' + hash);

                this.addSingleObjectSync(gossip, thash, target);
                
                dependencies.add(root, thash);
                rootAncestors.add(thash, root);

                if (mode === SyncMode.recursive) {
                    Mesh.syncCommandsLog.trace('tracking ops for ' + thash + ' (a ' + target.getClassName() + ')');
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
            peerGroupSyncAgents.set(mutHash, sync);
            gossip.trackAgentState(sync.getAgentId());
            this.pod.registerAgent(sync);    
        }
    
        
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
        let refs = await mut.getStore().loadByReference('targetObject', mut.getLastHash());


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

        let hash = mut.getLastHash();

        if (!newOpCallbacks.has(hash)) {
            let callback = async (opHash: Hash) => {
                let op = await mut.getStore().load(opHash, false, false);
                if (op !== undefined && 
                    mut.getAcceptedMutationOpClasses().indexOf(op.getClassName()) >= 0) {
                        let mutOp = op as MutationOp;
                        const roots = this.allRootAncestors.get(gossip.gossipId)?.get(mutOp.getTargetObject().getLastHash())

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

            mut.getStore().watchReferences('targetObject', mut.getLastHash(), callback);
        }
    }

    private unwatchForNewOps(gossip: StateGossipAgent, mutHash: Hash, store: Store) {
        let newOpCallbacks = this.allNewOpCallbacks.get(gossip.gossipId);

        const callback = newOpCallbacks?.get(mutHash);
        
        if (callback !== undefined) {
            store.removeReferencesWatch('targetObject', mutHash, callback);
            newOpCallbacks?.delete(mutHash);
        }   
    }


    private registerUsage(usageInfo: UsageInfo, usageToken?: UsageToken): UsageToken {
        
        const token = usageToken || Mesh.createUsageToken();

        this.usageTokens.set(token, usageInfo);

        const usageKey = Mesh.createUsageKey(usageInfo);

        this.usage.add(usageKey, token);

        return token;
    }

    private deregisterUsage(token: UsageToken, expectedType: string): UsageInfo | undefined {
        
        const usageInfo = this.usageTokens.get(token);

        if (usageInfo !== undefined) {
            if (usageInfo.type !== expectedType) {
                throw new Error('Refusing to deregister usage token ' + token + ': it is being used as for ' + expectedType + ', but originally was for ' + usageInfo.type);
            }

            const usageKey = Mesh.createUsageKey(usageInfo);

            this.usage.delete(usageKey, token);
            this.usageTokens.delete(token);
            return usageInfo;
        } else {
            return undefined;
        }
    }

    public static createUsageToken(): UsageToken {
        return new RNGImpl().randomHexString(128);
    }
    
    private static createUsageKey(usageInfo: UsageInfo): UsageKey {

        if (usageInfo.type === 'peer-group') {
            return usageInfo.type + '-' + usageInfo.peerGroupId.replace(/[-]/g, '--');
        } else if (usageInfo.type === 'object-sync') {
            return usageInfo.type + '-' + usageInfo.objHash + '-' + usageInfo.peerGroupId.replace(/[-]/g, '--');
        } else {
            return usageInfo.type + '-' + usageInfo.objHash + '-' + usageInfo.broadcastedSuffixBits;
        }

    }

    async getDiscoveryPeerGroup(obj: HashedObject, resources?: Resources) : Promise<PeerGroupInfo> {

        resources = resources || obj.getResources();

        if (resources === undefined) {
            throw new Error('Could not find a valid resources object to use for the discovery peer group.');
        }

        let localPeer = resources.getPeersForDiscovery()[0];
        let peerSource = new ObjectDiscoveryPeerSource(this, obj, resources.config.linkupServers, LinkupAddress.fromURL(localPeer.endpoint, localPeer.identity), resources.getEndointParserForDiscovery());

        return {
            id: Mesh.discoveryPeerGroupId(obj),
            localPeer: localPeer,
            peerSource: peerSource
        };

    }

    static discoveryPeerGroupId(obj: HashedObject) {
        return  'sync-for-' + obj.getLastHash();
    }

    private inferPeerGroupId(mut: MutableObject) {
        const mutHash = mut.getLastHash();

        const agents = this.gossipIdsPerObject.get(mutHash);

        if (agents.size !== 1) {
            throw new CannotInferPeerGroup(mutHash);
        } else {
            return agents.values().next().value as string;
        }
    }

}

export { Mesh, PeerGroupInfo, SyncMode, UsageToken, CannotInferPeerGroup }