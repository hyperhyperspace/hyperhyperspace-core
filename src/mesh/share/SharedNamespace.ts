
import { PeerInfo, PeerSource } from '../agents/peer';
import { MutableObject, Hash, HashedObject } from 'data/model';
import { Store } from 'storage/store';
import { IdbBackend } from 'storage/backends';
import { Mesh, SyncMode } from 'mesh/service/Mesh';
import { PeerGroupAgentConfig } from 'mesh/agents/peer/PeerGroupAgent';

type Config = {
    syncDependencies?: boolean
    peerGroupAgentConfig?: PeerGroupAgentConfig;
}

type Resources = {
    store: Store,
    mesh: Mesh
}

class SharedNamespace {

    spaceId    : string;
    localPeer  : PeerInfo;
    peerSource? : PeerSource;

    syncDependencies: boolean;
    peerGroupAgentConfig: PeerGroupAgentConfig;

    store: Store;

    mesh: Mesh;

    objects : Map<Hash, MutableObject>;
    definedKeys: Map<string, MutableObject>;
    started : boolean;



    constructor(spaceId: string, localPeer: PeerInfo, config?: Config, resources?: Partial<Resources>) {

        this.spaceId   = spaceId;
        this.localPeer = localPeer;

        if (resources?.store !== undefined) {
            this.store = resources.store;
        } else {
            this.store = new Store(new IdbBackend('group-shared-space-' + spaceId + '-' + localPeer.identityHash));
        }

        if (resources?.mesh !== undefined) {
            this.mesh = resources.mesh;
        } else {
            this.mesh = new Mesh();
        }

        
        if (config?.syncDependencies !== undefined) {
            this.syncDependencies = config.syncDependencies;
        } else {
            this.syncDependencies = true;
        }

        if (config?.peerGroupAgentConfig !== undefined) {
            this.peerGroupAgentConfig = config?.peerGroupAgentConfig;
        } else {
            this.peerGroupAgentConfig = { }; // empty config (defaults)
        }

        this.objects = new Map();
        this.definedKeys = new Map();
        this.started = false;
    }

    connect() {
        
        if (this.peerSource === undefined) {
            throw new Error("Cannot connect before setting a peerSource");
        }

        this.mesh.joinPeerGroup({id: this.spaceId, localPeer: this.localPeer, peerSource: this.peerSource}, this.peerGroupAgentConfig);
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

    getMesh() {
        return this.mesh;
    }

    getStore() {
        return this.store;
    }

    async attach(key: string, mut: MutableObject) : Promise<void> {

        mut.setId(HashedObject.generateIdForPath(this.spaceId, key));
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

            this.mesh.syncObjectWithPeerGroup(this.spaceId, mut, SyncMode.recursive);
        }
    }

}

export { SharedNamespace };