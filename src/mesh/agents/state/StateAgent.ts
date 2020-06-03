import { Hash, HashedObject } from 'data/model';

import { Agent } from '../../network/Agent';
import { Endpoint } from '../../network/Network';

interface StateAgent extends Agent {
    
    receiveRemoteState(sender: Endpoint, stateHash: Hash, state?: HashedObject) : Promise<boolean>;

}

export { StateAgent }