import { Peer, PeerSource, PeerGroupAgent } from '../agents/peer';
import { MutableObject, HashedObject, Hash } from 'data/model';
import { AgentPod } from './AgentPod';
import { NetworkAgent, SecureNetworkAgent } from 'mesh/agents/network';
import { StateGossipAgent } from 'mesh/agents/state';

type gossipId  = string;

class Mesh {

    pod: AgentPod;

    network: NetworkAgent;
    secured: SecureNetworkAgent;

    tracked: Map<gossipId, Set<Hash>>;

    constructor() {
        this.pod = new AgentPod();

        this.network = new NetworkAgent();
        this.pod.registerAgent(this.network);
        this.secured = new SecureNetworkAgent();
        this.pod.registerAgent(this.secured);

        this.tracked = new Map();
    }

    joinPeerGroup(peerGroupId: string, localPeer: Peer, peerSource: PeerSource) {

        let agent = this.pod.getAgent(PeerGroupAgent.agentIdForPeerGroup(peerGroupId));

        if (agent === undefined) {
            agent = new PeerGroupAgent(peerGroupId, localPeer, peerSource);
        }

        this.pod.registerAgent(agent);
    }

    syncObjectWithPeerGroup(peerGroupId: string, mut: MutableObject, recursive=true, gossipId?: string) {
        
        let mesh = this.pod.getAgent(PeerGroupAgent.agentIdForPeerGroup(peerGroupId)) as PeerGroupAgent | undefined;
        if (mesh === undefined) {
            throw new Error("Cannot sync object with mesh " + peerGroupId + ", need to join it first.");
        }

        if (gossipId === undefined) {
            gossipId = peerGroupId;
        }

        let gossip = this.pod.getAgent(StateGossipAgent.agentIdForGossip(gossipId)) as StateGossipAgent | undefined;
        if (gossip === undefined) {
            gossip = new StateGossipAgent(gossipId, mesh);
            this.pod.registerAgent(gossip);
        }
        
        let t = this.tracked.get(gossipId)
        if (t === undefined) {
            t = new Set();
            this.tracked.set(gossipId, t);
        }
        
        let hash = mut.hash();

        if (!t.has(hash)) {

            t.add(hash);
            let sync = mut.createSyncAgent(mesh);

            gossip.trackAgentState(sync.getAgentId());
            this.pod.registerAgent(sync);

            if (recursive) {
                this.listenForNewOps(peerGroupId, gossipId, mut);
                this.trackMutableDepsInOps(peerGroupId, gossipId, mut);
            }
        }
    }

    syncManyObjectsWithPeerGroup(peerGroupId: string, muts: IterableIterator<MutableObject>, recursive = true, gossipId?: string) {
        
        for (const mut of muts) {
            this.syncObjectWithPeerGroup(peerGroupId, mut, recursive, gossipId);
        }

    }

    // recursive tracking of subobjects for state gossip & sync


    // Fetch existing ops on the databse and check if there are any mutable
    // references to track.
    private async trackMutableDepsInOps(peerGroupId: string, gossipId: string, mut: MutableObject) {
        let prev = await mut.getStore().loadByReference('target', mut.getLastHash());

        for (let obj of prev.objects) {
            this.trackMutableDeps(peerGroupId, gossipId, obj);
        }
    }

    // Check the deps of obj for mutable objects and track them.
    private async trackMutableDeps(peerGroupId: string, gossipId: string, obj: HashedObject) {
        
        let context = obj.toContext();

        for (let [hash, dep] of context.objects.entries()) {
            if (context.rootHashes.indexOf(hash) < 0) {
                if (dep instanceof MutableObject &&
                    !this.tracked.get(gossipId)?.has(hash)) {
                    this.syncObjectWithPeerGroup(peerGroupId, dep, true, gossipId);
                }
            }
        }

        let externalDeps = context.findMissingDeps(context.rootHashes[0]);

        const store = obj.getStore();
        for (let hash of externalDeps.keys()) {
            let dep = await store.load(hash) as HashedObject;
            this.trackMutableDeps(peerGroupId, gossipId, dep);
        }

    }

    private listenForNewOps(peerGroupId: string, gossipId:string, mut: MutableObject) {

        mut.getStore().watchReferences('target', mut.getLastHash(), async (opHash: Hash) => {
            let op = await mut.getStore().load(opHash);
            if (op !== undefined && 
                mut.getAcceptedMutationOpClasses().indexOf(op?.getClassName()) >= 0) {

                this.trackMutableDeps(peerGroupId, gossipId, op);
            }
        });
    }

}

export { Mesh }