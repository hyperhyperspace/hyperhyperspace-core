import { Hash, HashedObject } from 'data/model';

import { Agent } from '../../swarm/Agent';
import { PeerId } from '../../swarm/Peer';

interface StateAgent extends Agent {
    
    receiveRemoteState(sender: PeerId, stateHash: Hash, state?: HashedObject) : Promise<boolean>;

}

export { StateAgent }