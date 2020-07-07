
import { Peer, PeerSource } from '../agents/peer';
import { MutableObject, Hash } from 'data/model';
import { Store, IdbBackend } from 'data/storage';
import { Namespace } from 'data/model/Namespace';
import { MeshService } from 'mesh/service/MeshService';

type Config = {
    syncDependencies?: boolean
}

type Resources = {
    store: Store,
    mesh: MeshService
}

class GroupSharedSpace {

    spaceId    : string;
    localPeer  : Peer;
    peerSource? : PeerSource;

    syncDependencies: boolean;

    namespace: Namespace;
    store: Store;

    mesh: MeshService;

    objects : Map<Hash, MutableObject>;
    definedKeys: Map<string, MutableObject>;
    started : boolean;



    constructor(spaceId: string, localPeer: Peer, config?: Config, resources?: Partial<Resources>) {

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
            this.mesh = new MeshService();
        }

        
        if (config?.syncDependencies !== undefined) {
            this.syncDependencies = config.syncDependencies;
        } else {
            this.syncDependencies = true;
        }

        this.namespace = new Namespace(spaceId);

        this.objects = new Map();
        this.definedKeys = new Map();
        this.started = false;
    }

    connect() {
        
        if (this.peerSource === undefined) {
            throw new Error("Cannot connect before setting a peerSource");
        }

        this.mesh.joinMesh(this.spaceId, this.localPeer, this.peerSource);
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

            this.mesh.syncObjectWithMesh(this.spaceId, mut, this.syncDependencies)
        }
    }

}

export { GroupSharedSpace };