import { AgentPod } from '../common';
import { NetworkAgent } from '../agents/network';
import { SecureNetworkAgent } from '../agents/network/SecureNetworkAgent';
import { PeerMeshAgent, Peer, PeerSource } from '../agents/peer';
import { StateGossipAgent, StateSyncAgent } from '../agents/state';
import { MutableObject, Hash, HashedObject } from 'data/model';

class GroupSharedSpace {

    groupId    : string;
    localPeer  : Peer;
    peerSource : PeerSource;

    syncDependencies: boolean;

    objects : Map<Hash, MutableObject>;
    started : boolean;

    pod? : AgentPod;

    network       : NetworkAgent;
    secureNetwork : SecureNetworkAgent;
    peerNetwork   : PeerMeshAgent;
    gossip        : StateGossipAgent;

    syncAgents    : Map<Hash, StateSyncAgent>;

    constructor(groupId: string, localPeer: Peer, peerSource: PeerSource, syncDependencies=true) {

        this.groupId     = groupId;
        this.localPeer  = localPeer;
        this.peerSource = peerSource;

        this.syncDependencies = syncDependencies;

        this.objects = new Map();
        this.started = false;

        this.network       = new NetworkAgent();
        this.secureNetwork = new SecureNetworkAgent();
        this.peerNetwork   = new PeerMeshAgent(this.groupId, this.localPeer, this.peerSource);
        this.gossip        = new StateGossipAgent('gossip-for' + this.groupId, this.peerNetwork);

        this.syncAgents = new Map();
    }

    start() {

        this.pod = new AgentPod();

        this.pod.registerAgent(this.network);
        this.pod.registerAgent(this.secureNetwork);
        this.pod.registerAgent(this.peerNetwork);
        this.pod.registerAgent(this.gossip);

        for (const [hash, mut] of this.objects) {
            let agent = this.syncAgents.get(hash) as StateSyncAgent;
            this.startStateSyncAgent(mut, agent);
        }

        this.started = true;
    }

    addObject(mut: MutableObject) {
        let syncAgent = this.createStateSyncAgent(mut);
        if (this.started) {
            this.startStateSyncAgent(mut, syncAgent)
        }
    }

    private createStateSyncAgent(mut: MutableObject) {

        let hash = mut.hash();

        let syncAgent = this.syncAgents.get(hash);

        if (syncAgent === undefined) {
            this.objects.set(hash, mut);
            syncAgent = mut.createSyncAgent(this.peerNetwork as PeerMeshAgent);
            this.syncAgents.set(hash, syncAgent);
        }

        return syncAgent;
    }

    private startStateSyncAgent(mut: MutableObject, agent: StateSyncAgent) {
        this.pod?.registerAgent(agent);
        if (this.syncDependencies) {
            this.listenForNewOps(mut);
            this.trackMutableDepsInOps(mut);
        }
    }

    private listenForNewOps(mut: MutableObject) {

        mut.getStore().watchReferences('target', mut.getLastHash(), async (opHash: Hash) => {
            let op = await mut.getStore().load(opHash);
            if (op !== undefined && 
                mut.getAcceptedMutationOpClasses().indexOf(op?.getClassName()) >= 0) {

                this.trackMutableDeps(op);
            }
        });
    }

    private async trackMutableDepsInOps(mut: MutableObject) {
        let prev = await mut.getStore().loadByReference('target', mut.getLastHash());

        for (let obj of prev.objects) {
            this.trackMutableDeps(obj);
        }
    }

    private async trackMutableDeps(obj: HashedObject) {
        let context = obj.toContext();

        for (let [hash, dep] of context.objects.entries()) {
            if (context.rootHashes.indexOf(hash) < 0) {
                if (dep instanceof MutableObject &&
                    !this.objects.has(hash)) {
                    this.addObject(dep);
                }
            }
        }

        let externalDeps = context.findMissingDeps(context.rootHashes[0]);

        const store = obj.getStore();
        for (let hash of externalDeps.keys()) {
            let dep = await store.load(hash) as HashedObject;
            this.trackMutableDeps(dep);
        }

    }

}

export { GroupSharedSpace };