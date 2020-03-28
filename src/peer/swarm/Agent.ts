import { Swarm } from "./Swarm";
import { HashedObject } from 'data/model';


abstract class Agent {

    // give agent references to a working swarm & store
    abstract setSwarm(swarm: Swarm): void;

    // ask agent for the live root object
    abstract getLiveRootObject(): HashedObject;
}

export { Agent };