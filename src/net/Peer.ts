import { Store, IdbBackend } from "data/storage";
import { Identity } from 'data/identity';
import { Hash } from 'data/model';
import { Swarm } from './swarm/Swarm';
import { Agent } from './swarm/Agent';

class Peer {

    id: Promise<Identity>;

    store: Store;
    swarms: Map<Hash, Swarm>;

    constructor(id: Hash) {
        this.store = new Store(new IdbBackend('hhs-object-store-' + id));
        this.id = this.store.load(id) as Promise<Identity>;
        this.swarms = new Map();
    }

    activateSwarm(agent: Agent) {
        let swarm = new Swarm(agent);

        this.swarms.set(agent.getLiveRootObject().hash(), swarm);
        
        swarm.start();
    }

    deactivateSwarm(rootId: Hash) {
        this.swarms.get(rootId)?.stop();
    }

    getStore() {
        return this.store;
    }
}

export { Peer };