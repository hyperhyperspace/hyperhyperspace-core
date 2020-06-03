import { StateAgent } from 'mesh/agents/state/StateAgent';
import { Network, Event, Endpoint } from 'mesh/network';
import { HashedObject, Hash } from 'data/model';
import { StateGossipAgent } from 'mesh/agents/state/StateGossipAgent';
import { Logger, LogLevel } from 'util/logging';
import { SwarmControlAgent, SwarmAgent } from 'mesh/agents/swarm';


class LinearState extends HashedObject {

    static className = 'hhs-test/LinearStateUpdate';


    seq?: number;
    message?: string;

    constructor(seq?: number, message?: string) {
        super();

        if (seq !== undefined) {
            this.seq = seq;
        }

        if (message !== undefined) {
            this.message = message;
        }
    }

    getClassName(): string {
        return LinearState.className;
    }

    init(): void {
        //
    }
    
}

enum MessageType {
    RequestState = 'request-state',
    SendState    = 'send-state'
}

interface RequestStateMessage {
    type: MessageType.RequestState
}

interface SendStateMessage {
    type: MessageType.SendState,
    state: LinearState
}

type LinearStateMessage = RequestStateMessage | SendStateMessage;

HashedObject.registerClass(LinearState.className, LinearState);

class LinearStateAgent extends SwarmAgent implements StateAgent {

    static logger = new Logger(LinearState.name, LogLevel.INFO);

    static createId(id: string) {
        return 'linear-state-agent-' + id;
    }

    id: string;

    swarm?: Network;
    gossipAgent?: StateGossipAgent;

    seq?: number;
    message?: string;

    state?: LinearState;
    prevStates : Set<Hash>;

    constructor(id: string, swarmControl: SwarmControlAgent) {
        super(swarmControl);
        this.id = id;
        this.prevStates = new Set();
    }

    getAgentId(): string {
        return  LinearStateAgent.createId(this.id);
    }


    setMessage(message: string, seq?: number) {

        

        if ((this.seq !== undefined && seq === undefined) || (seq !== undefined && this.seq !== undefined && seq < this.seq)) {
            LinearStateAgent.logger.debug('\nignoring: message=' + message + ', seq=' + seq + '\n' + 
                        'at state: message=' + this.message + ', seq=' + this.seq);
            return;
        } else if (seq === this.seq && this.message !== undefined && this.message.localeCompare(message) >= 0) {
            LinearStateAgent.logger.debug('\nignoring: message=' + message + ', seq=' + seq + '\n' + 
                        'at state: message=' + this.message + ', seq=' + this.seq);
            return;
        }

        LinearStateAgent.logger.debug('\naccepting: message=' + message + ', seq=' + seq + '\n' + 
                    'at state:  message=' + this.message + ', seq=' + this.seq);

        if (seq === undefined) {
            if (this.seq === undefined) {
                this.seq = 0;
            } else {
                this.seq = this.seq + 1;
            }    
        } else {
            this.seq = seq;
        }

        this.message = message;

        if (this.state !== undefined) {
            this.prevStates.add(this.state.hash())
        }

        this.state = new LinearState(this.seq, this.message)

        

        this.gossipAgent?.localAgentStateUpdate(this.getAgentId(), this.state);
    }


    ready(swarm: Network): void {
        this.swarm = swarm;
        this.gossipAgent = swarm.getLocalAgent(StateGossipAgent.Id) as StateGossipAgent;
    }

    receiveLocalEvent(ev: Event): void {
        ev;
        // ignore
    }

    /*receiveMessage(message: Message): void {
        message;
        // ignore
    }*/

    receivePeerMessage(source: Endpoint, sender: Hash, recipient: Hash, content: any): void {
        
        recipient;

        let m = content as LinearStateMessage;

        if (m.type === MessageType.RequestState) {
            this.sendState(source);
        }

        if (m.type === MessageType.SendState) {
            this.receiveRemoteState(sender, m.state.hash(), m.state);
        }
    }

    async receiveRemoteState(sender: Endpoint, stateHash: Hash, state?: HashedObject): Promise<boolean> {

        if (state === undefined) {
            if (!this.prevStates.has(stateHash)) {
                this.requestState(sender);
            }
        } else {
            const linearState = state as LinearState;

            if (linearState.seq !== undefined && linearState.message !== undefined) {
                if (this.seq === undefined || 
                    linearState.seq > this.seq || 
                     ( linearState.seq === this.seq &&
                       ( this.message === undefined || 
                         linearState.message.localeCompare(this.message) > 0
                       )
                     )
                   ) {

                    this.setMessage(linearState.message, linearState.seq);
                    return true;
                } 
            }

        }

        return false;

    }

    private requestState(endpoint: Endpoint) {
        let requestStateMessage : RequestStateMessage = {
            type: MessageType.RequestState
        }

        this.swarmControl.sendToPeer(endpoint, this.getAgentId(), requestStateMessage);
    }

    private sendState(endpoint: Endpoint) {
        let sendStateMessage : SendStateMessage = {
            type: MessageType.SendState,
            state: this.state as LinearState
        }

        this.swarmControl.sendToPeer(endpoint, this.getAgentId(), sendStateMessage);
    }

}

export { LinearStateAgent }