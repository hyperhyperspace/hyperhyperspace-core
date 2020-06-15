import { AgentPod } from '../base/AgentPod';
import { NetworkAgent } from '../agents/network';
import { SecureNetworkAgent } from '../agents/network/SecureNetworkAgent';
import { SwarmControlAgent, Peer, PeerSource } from '../agents/swarm';
import { Store } from 'data/storage';
import { MutableObject, Hash } from 'data/model';
import { StateGossipAgent } from 'mesh/agents/state';

class PeerGroupSyncService {

    groupId    : string;
    localPeer  : Peer;
    peerSource : PeerSource;
    store      : Store;

    objectHashes : Set<Hash>;

    started      : boolean;
    objectsToAdd : Array<MutableObject>;

    pod? : AgentPod;

    network?       : NetworkAgent;
    secureNetwork? : SecureNetworkAgent;
    swarmControl?  : SwarmControlAgent;
    gossip?        : StateGossipAgent;


    constructor(groupId: string, localPeer: Peer, peerSource: PeerSource, store: Store) {

        this.groupId     = groupId;
        this.localPeer  = localPeer;
        this.peerSource = peerSource;
        this.store      = store;

        this.objectHashes = new Set<Hash>();

        this.started = false;
        this.objectsToAdd = [];
    }

    start() {

        this.pod = new AgentPod();

        this.network = new NetworkAgent();
        this.pod.registerAgent(this.network);
        this.secureNetwork = new SecureNetworkAgent();
        this.pod.registerAgent(this.secureNetwork);
        this.swarmControl = new SwarmControlAgent('sync-for-' + this.groupId, this.localPeer, this.peerSource);
        this.pod.registerAgent(this.swarmControl);
        this.gossip  = new StateGossipAgent('sync-for-' + this.groupId, this.swarmControl);
        this.pod.registerAgent(this.gossip);

        while (this.objectsToAdd.length > 0) {
            let mut = this.objectsToAdd.shift() as MutableObject;
            this.trackState(mut);
        }

        this.started = true;
    }

    addObject(mut: MutableObject) {
        if (this.started) {
            this.trackState(mut);
        } else {
            this.objectsToAdd.push(mut);
        }

    }

    private trackState(mut: MutableObject) {
        this.objectHashes.add(mut.hash());
        let syncAgent = mut.createSyncAgentForSwarm(this.swarmControl as SwarmControlAgent);
        this.pod?.registerAgent(syncAgent);
    }

}

export { PeerGroupSyncService };