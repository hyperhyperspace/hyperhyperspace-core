import { Hash, HashedObject } from 'data/model';
import { Agent } from '../../service/Agent';
import { Endpoint } from '../network/NetworkAgent';

interface StateSyncAgent extends Agent {
    
    receiveRemoteState(sender: Endpoint, stateHash: Hash, state: HashedObject) : Promise<boolean>;
    expectingMoreOps(receivedOpHashes?: Set<Hash>): boolean;

}

export { StateSyncAgent }