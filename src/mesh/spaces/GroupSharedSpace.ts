import { AgentPod } from '../common';
import { NetworkAgent } from '../agents/network';
import { SecureNetworkAgent } from '../agents/network/SecureNetworkAgent';
import { PeerMeshAgent, Peer, PeerSource, EmptyPeerSource } from '../agents/peer';
import { StateGossipAgent, StateSyncAgent } from '../agents/state';
import { MutableObject, Hash, HashedObject } from 'data/model';
import { Store, IdbBackend } from 'data/storage';
import { Agent } from 'mesh/base/Agent';
import { Namespace } from 'data/model/Namespace';

type Config = {
    syncDependencies?: boolean
}

type Resources = {
    peerSource: PeerSource,
    store: Store,
    pod: AgentPod
}

class GroupSharedSpace {

    spaceId    : string;
    localPeer  : Peer;
    peerSource : PeerSource;

    syncDependencies: boolean;

    namespace: Namespace;
    store: Store;

    objects : Map<Hash, MutableObject>;
    definedKeys: Map<string, MutableObject>;
    initialized : boolean;
    started : boolean;

    pod : AgentPod;
    
    network?       : NetworkAgent;
    secureNetwork? : SecureNetworkAgent;
    peerMesh?      : PeerMeshAgent;
    gossip?        : StateGossipAgent;

    syncAgents    : Map<Hash, StateSyncAgent>;

    constructor(spaceId: string, localPeer: Peer, config?: Config, resources?: Partial<Resources>) {

        this.spaceId     = spaceId;
        this.localPeer  = localPeer;
        
        if (resources?.peerSource !== undefined) {
            this.peerSource = resources?.peerSource;
        } else {
            this.peerSource = new EmptyPeerSource();
        }

        if (resources?.store !== undefined) {
            this.store = resources.store;
        } else {
            this.store = new Store(new IdbBackend('group-shared-space-' + spaceId + '-' + localPeer.identityHash));
        }

        if (resources?.pod !== undefined) {
            this.pod = resources.pod;
        } else {
            this.pod = new AgentPod();
        }
        
        if (config?.syncDependencies !== undefined) {
            this.syncDependencies = config.syncDependencies;
        } else {
            this.syncDependencies = true;
        }

        this.namespace = new Namespace(spaceId);

        this.objects = new Map();
        this.definedKeys = new Map();
        this.initialized = false;
        this.started = false;

        this.syncAgents = new Map();
    }

    setPeerSource(peerSource: PeerSource) {

        if (this.started) {
            throw new Error("Can't change peer source after space has started.");
        }
        this.peerSource = peerSource;
    }

    getPeerSource() {
        return this.peerSource;
    }

    getPod() {
        return this.pod;
    }

    getStore() {
        return this.store;
    }

    init() {
        this.network       = new NetworkAgent();
        this.secureNetwork = new SecureNetworkAgent();
        this.peerMesh      = new PeerMeshAgent(this.spaceId, this.localPeer, this.peerSource);
        this.gossip        = new StateGossipAgent('gossip-for' + this.spaceId, this.peerMesh);

        this.initialized = true;
    }

    start() {

        if (!this.initialized) {
            this.init();
        }

        this.pod.registerAgent(this.network as Agent);
        this.pod.registerAgent(this.secureNetwork as Agent);
        this.pod.registerAgent(this.peerMesh as Agent);
        this.pod.registerAgent(this.gossip as Agent);

        for (const mut of this.objects.values()) {
            let syncAgent = this.createStateSyncAgent(mut);
            this.startStateSyncAgent(mut, syncAgent);
        }

        this.started = true;
    }

    async attach(key: string, mut: MutableObject) : Promise<void> {

        this.namespace.define(key, mut);
        this.definedKeys.set(key, mut);
        await this.store.save(mut);
        this.addObject(mut);
        
    }

    get(key: string) {
        return this.definedKeys.get(key);
    }

    private addObject(mut: MutableObject) {
        let hash = mut.hash();

        if (!this.objects.has(hash)) {
            this.objects.set(mut.hash(), mut);

            if (this.started) {
                let syncAgent = this.createStateSyncAgent(mut);
                this.startStateSyncAgent(mut, syncAgent)
            }
        }
    }

    private createStateSyncAgent(mut: MutableObject) {

        let hash = mut.hash();

        let syncAgent = this.syncAgents.get(hash);

        if (syncAgent === undefined) {
            this.objects.set(hash, mut);
            syncAgent = mut.createSyncAgent(this.peerMesh as PeerMeshAgent);
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