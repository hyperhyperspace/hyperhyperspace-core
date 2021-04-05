import { PeerGroupAgent } from './PeerGroupAgent';
import { Agent, AgentId } from '../../service/Agent';
import { AgentPod, Event } from '../../service/AgentPod';
import { Endpoint } from '../network/NetworkAgent';

import { Hash } from 'data/model';

abstract class PeeringAgentBase implements Agent {

    peerGroupAgent: PeerGroupAgent;

    constructor(peerGroupAgent: PeerGroupAgent) {
        this.peerGroupAgent = peerGroupAgent;
    }

    abstract getAgentId(): string;
    abstract ready(pod: AgentPod): void;
    abstract shutdown(): void;

    receiveLocalEvent(ev: Event): void {
        ev;
    }
    
    getPeerControl() {
        return this.peerGroupAgent;
    }

    sendMessageToPeer(destination: Endpoint, agentId: AgentId, content: any) : boolean {
        return this.peerGroupAgent.sendToPeer(destination, agentId, content);
    }

    sendingQueueToPeerIsEmpty(destination: Endpoint): boolean {
        return this.peerGroupAgent.peerSendBufferIsEmpty(destination);
    }

    abstract receivePeerMessage(source: Endpoint, sender: Hash, recipient: Hash, content: any) : void;

}

export { PeeringAgentBase };