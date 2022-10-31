import { Hash, HashedObject, MutableObject } from 'data/model';
import { EventRelay } from 'util/events';
import { Agent } from '../../service/Agent';
import { Endpoint } from '../network/NetworkAgent';
import { SyncState } from './SyncObserverAgent';

interface StateSyncAgent extends Agent {
    
    receiveRemoteState(sender: Endpoint, stateHash: Hash, state: HashedObject) : Promise<boolean>;
    expectingMoreOps(receivedOpHashes?: Set<Hash>): boolean;

    getMutableObject(): MutableObject;
    getPeerGroupId(): string;

    getSyncState(): SyncState;
    getSyncEventSource(): EventRelay<HashedObject>;
}

export { StateSyncAgent }