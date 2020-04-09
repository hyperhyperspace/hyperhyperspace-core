import { HashedObject, Hash, MutableObject } from "data/model";
import { Identity } from 'data/identity';
import { Agent } from './Agent';

/*
class ObjectKnownStates {

    hash: Hash;

    // known states for the object, and peers that advertise such state
    peerIdsByState: Map<Hash, Set<Hash>>;
    stateForPeerId: Map<Hash, Hash>;

    attachedPeerIds: Set<Hash>;

    constructor(hash: Hash) {
        this.hash = hash;
        this.peerIdsByState = new Map();
        this.stateForPeerId = new Map();
        this.attachedPeerIds = new Set();
    }

    updateState(peerId: Hash, state: Hash) : boolean {
        let oldState = this.stateForPeerId.get(peerId);

        if (oldState === state) {
            return false;
        } else {
            let peerIdsInOldState = this.peerIdsByState.get(oldState as Hash);
            peerIdsInOldState?.delete(peerId);

            let peerIdsInState = this.peerIdsByState.get(state);
            if (peerIdsInState === undefined) {
                peerIdsInState = new Set();
            }
            peerIdsInState.add(state);

            this.stateForPeerId.set(peerId, state);

            return true;
        }
    }
}

*/

type PeerStatus = 'unknown'|'connected'|'online'|'offline';

class AttachedObjectInfo {
    mutable: MutableObject;
    priority: Priority = 'low';

    constructor(mutable: MutableObject, priority?: Priority) {
        this.mutable = mutable;
        this.setPriority(priority);
    }

    setPriority(priority?: Priority) {
        this.priority = priority === undefined ? 'low' : priority;
    }
}

class PeerInfo {
    id: Identity;
    status: PeerStatus;
    lastSeen?: Date;

    objectStatus: Map<Hash, HashedObject>; 

    constructor(id: Identity) {
        this.id = id;
        this.status = 'unknown';

        this.objectStatus = new Map();
    }

}

type Priority = 'high'|'low';

class Swarm {

    root: HashedObject;

    attachedObjects: Map<Hash, AttachedObjectInfo>;
    
    peers: Map<Hash, PeerInfo>;
    connectedPeers: Set<Hash>;

    constructor(agent: Agent) {
        agent.setSwarm(this);
        
        this.root = agent.getLiveRootObject();
        this.attachedObjects = new Map();

        this.peers = new Map();
        this.connectedPeers = new Set(); 
    }

    attachObject(mutable: MutableObject, priority?: Priority) {

        let hash = mutable.hash();

        let objectInfo = this.attachedObjects.get(hash);

        if (objectInfo === undefined) {
            objectInfo =  new AttachedObjectInfo(mutable, priority);
            this.attachedObjects.set(hash, objectInfo);
        } else {
            objectInfo.mutable = mutable;
            objectInfo.setPriority(priority);
        }
    }

    getAttachedObject(hash: Hash) : MutableObject|undefined {
        return this.attachedObjects.get(hash)?.mutable;
    }

    addPeer(id: Identity) {
        let hash = id.hash();
        if (this.peers.get(hash) === undefined) {
            this.peers.set(hash, new PeerInfo(id));
        }
    }

    start() : void {

    }

    stop() : void {

    }
}

export { Swarm };