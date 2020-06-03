import { SwarmControlAgent } from './SwarmControlAgent';
import { Agent, AgentId } from "../../network/Agent";
import { Endpoint, Network, Event } from '../../network/Network';
import { Hash } from 'data/model';

abstract class SwarmAgent implements Agent {

    swarmControl: SwarmControlAgent;

    constructor(swarmControl: SwarmControlAgent) {
        this.swarmControl = swarmControl;
    }

    abstract getAgentId(): string;
    abstract ready(network: Network): void;

    receiveMessage(connId: string, source: string, destination: string, content: any): void {
        connId; source; destination; content;
    }

    receiveLocalEvent(ev: Event): void {
        ev;
    }
    
    getSwarmControl() {
        return this.swarmControl;
    }

    sendMessageToPeer(destination: Endpoint, agentId: AgentId, content: any) : boolean {
        return this.swarmControl.sendToPeer(destination, agentId, content);
    }

    abstract receivePeerMessage(source: Endpoint, sender: Hash, recipient: Hash, content: any) : void;

}

export { SwarmAgent }