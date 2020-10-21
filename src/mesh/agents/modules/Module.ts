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
    accessSecret?: string;
    

    private peerGroupSyncs: Map<string, PeerGroupSync>;

    constructor() {
        this.peerGroupSyncs = new Map();
    }

    getInitialPeerGroup(hashFragment?: string, minPeers=1): PeerSource {
        throw new Error('implement this');
    }

    provideInitialPeers(): void {

    }

    joinPeerGroup(peerGroupId: string, localPeer: PeerInfo, peerSource: PeerSource) {

    }

    leavePeerGroup(peerGroupId: string) {

    }

    addSyncTarget(peerGroupId: string, target: HashedObject, mode: SyncMode) {

    }

    removeSyncTarget(peerGroupId: string, targetHash: Hash) {

    }



    getAgentId(): string {
        throw new Error('Method not implemented.');
    }

    ready(pod: AgentPod): void {
        throw new Error('Method not implemented.');
    }

    receiveLocalEvent(ev: Event): void {
        throw new Error('Method not implemented.');
    }

    shutdown(): void {
        throw new Error('Method not implemented.');
    }

}

export { Module };