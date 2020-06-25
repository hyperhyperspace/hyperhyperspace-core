import { PeerMeshAgent } from './PeerMeshAgent';
import { Agent, AgentId } from '../../base/Agent';
import { AgentPod, Event } from '../../base/AgentPod';
import { Endpoint } from '../network/NetworkAgent';

import { Hash } from 'data/model';

abstract class PeeringAgent implements Agent {

    peerMesh: PeerMeshAgent;

    constructor(peerMesh: PeerMeshAgent) {
        this.peerMesh = peerMesh;
    }

    abstract getAgentId(): string;
    abstract ready(pod: AgentPod): void;

    receiveLocalEvent(ev: Event): void {
        ev;
    }
    
    getPeerControl() {
        return this.peerMesh;
    }

    sendMessageToPeer(destination: Endpoint, agentId: AgentId, content: any) : boolean {
        return this.peerMesh.sendToPeer(destination, agentId, content);
    }

    abstract receivePeerMessage(source: Endpoint, sender: Hash, recipient: Hash, content: any) : void;

}

export { PeeringAgent }