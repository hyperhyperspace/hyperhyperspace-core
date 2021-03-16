import { HashedObject } from 'data/model';
import { AgentPod } from 'mesh/service/AgentPod';
import { PeeringAgentBase } from '../peer/PeeringAgentBase';
import { StateSyncAgent } from './StateSyncAgent';




class CausalHistorySyncAgent extends PeeringAgentBase implements StateSyncAgent {

    receiveRemoteState(sender: string, stateHash: string, state?: HashedObject): Promise<boolean> {
        throw new Error('Method not implemented.');
    }

    sendState(target: string): void {
        throw new Error('Method not implemented.');
    }
    
    getAgentId(): string {
        throw new Error('Method not implemented.');
    }

    ready(pod: AgentPod): void {
        throw new Error('Method not implemented.');
    }

    shutdown(): void {
        throw new Error('Method not implemented.');
    }

    receivePeerMessage(source: string, sender: string, recipient: string, content: any): void {
        throw new Error('Method not implemented.');
    }

}

export { CausalHistorySyncAgent }