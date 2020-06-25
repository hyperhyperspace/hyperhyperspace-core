import { Hash, HashedObject } from 'data/model';

import { Agent } from '../../base/Agent';
import { Endpoint } from '../network/NetworkAgent';

interface StateSyncAgent extends Agent {
    
    receiveRemoteState(sender: Endpoint, stateHash: Hash, state?: HashedObject) : Promise<boolean>;
    sendState(target: Endpoint) : void;

}

export { StateSyncAgent }