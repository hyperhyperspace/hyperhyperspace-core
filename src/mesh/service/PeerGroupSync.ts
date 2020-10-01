import { Resources, Hash, HashedObject } from 'data/model';
import { PeerGroup } from './PeerGroup';
import { SyncMode, Mesh } from './Mesh';


class PeerGroupSync {

    resources?: Resources;

    peerGroup: PeerGroup;

    syncTargets: Map<Hash, HashedObject>;
    syncModes: Map<Hash, SyncMode>;
    started: boolean;

    constructor(peerGroup: PeerGroup) {

        this.peerGroup = peerGroup;

        this.syncTargets = new Map();
        this.syncModes   = new Map();
        this.started = false;
    }

    async setResources(resources: Resources) {

            this.resources = resources;
    }

    async start() {

        if (this.resources === undefined) {
            throw new Error('Sync cannot be started because it has not been initialized.');
        }

        if (!this.started) {

            this.resources.mesh.joinPeerGroup(await this.peerGroup.getPeerGroupInfo());
            this.started = true;

            for (const [hash, obj] of this.syncTargets.entries()) {
                let mode = this.syncModes.get(hash) as SyncMode;
                this.startMeshSync(obj, mode);
            }
        }
        
    }

    async stop() {
        if (this.resources === undefined) {
            throw new Error('Sync cannot be stopped because it has not been initialized.');
        }

        if (this.started) {
            this.resources.mesh.leavePeerGroup(this.peerGroup.getPeerGroupId());

            for (const hash of this.syncTargets.keys()) {
                this.stopMeshSync(hash);
            }

        }
    }

    addSyncTarget(obj: HashedObject, mode: SyncMode) {

        const hash = obj.hash();

        this.syncTargets.set(hash, obj);
        this.syncModes.set(hash, mode);

        if (this.started) {
            this.startMeshSync(obj, mode);
        }
    }

    removeSyncTarget(objHash: Hash) {

        if (this.syncTargets.has(objHash)) {
            this.syncTargets.delete(objHash);
            this.syncModes.delete(objHash);
            if (this.started) {
                this.stopMeshSync(objHash);
            }
        }

    }

    getPeerGroup() {
        return this.peerGroup;
    }

    private startMeshSync(obj: HashedObject, mode: SyncMode) {
        let mesh = this.resources?.mesh as Mesh;
        let peerGroupId = this.peerGroup?.getPeerGroupId() as string;

        mesh.syncObjectWithPeerGroup(peerGroupId, obj, mode);
    }

    private stopMeshSync(objHash: Hash) {
        let mesh = this.resources?.mesh as Mesh;
        let peerGroupId = this.peerGroup?.getPeerGroupId() as string;

        mesh.stopSyncObjectWithPeerGroup(peerGroupId, objHash);
    }

}

export { PeerGroupSync };