import { Hash, HashedObject } from 'data/model';
import { Agent } from 'mesh/service/Agent';
import { AgentPod, Event } from 'mesh/service/AgentPod';
import { SyncMode } from 'mesh/service/Mesh';
import { PeerGroupSync } from 'mesh/service/PeerGroupSync';

import { PeerInfo } from '../peer/PeerGroupAgent';
import { PeerSource } from '../peer/PeerSource';

/* A module is an agent that orchestates other agents in
 * order to provide specific functionality.
 * 
 * It can bootstrap initial data / peer groups.
 */

class Module implements Agent {

    rootHash?: Hash;
    

    peerGroupSyncs: Map<string, PeerGroupSync>;

    constructor() {
        this.peerGroupSyncs = new Map();
    }

    getInitialPeerGroup(_hashFragment?: string, _minPeers=1): PeerSource {
        throw new Error('implement this');
    }

    provideInitialPeers(): void {

    }

    joinPeerGroup(_peerGroupId: string, _localPeer: PeerInfo, _peerSource: PeerSource) {

    }

    leavePeerGroup(_peerGroupId: string) {

    }

    addSyncTarget(_peerGroupId: string, _target: HashedObject, _mode: SyncMode) {

    }

    removeSyncTarget(_peerGroupId: string, _targetHash: Hash) {

    }

    getAgentId(): string {
        throw new Error('Method not implemented.');
    }

    ready(_pod: AgentPod): void {
        throw new Error('Method not implemented.');
    }

    receiveLocalEvent(_ev: Event): void {
        throw new Error('Method not implemented.');
    }

    shutdown(): void {
        throw new Error('Method not implemented.');
    }

}

export { Module };