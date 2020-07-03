import { StateSyncAgent } from 'mesh/agents/state/StateSyncAgent';
import { Endpoint } from 'mesh/agents/network';
import { AgentPod, Event } from 'mesh/common';
import { HashedObject, Hash } from 'data/model';
import { StateGossipAgent } from 'mesh/agents/state/StateGossipAgent';
import { Logger, LogLevel } from 'util/logging';
import { PeerMeshAgent, PeeringAgent } from 'mesh/agents/peer';


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
    state: any
}

type LinearStateMessage = RequestStateMessage | SendStateMessage;

HashedObject.registerClass(LinearState.className, LinearState);

class LinearStateAgent extends PeeringAgent implements StateSyncAgent {

    static logger = new Logger(LinearState.name, LogLevel.INFO);

    static createId(id: string) {
        return 'linear-state-agent-' + id;
    }

    topic:string;
    id: string;

    pod?: AgentPod;
    gossipAgent?: StateGossipAgent;

    seq?: number;
    message?: string;

    state?: LinearState;
    prevStates : Set<Hash>;

    constructor(id: string, peerNetwork: PeerMeshAgent) {
        super(peerNetwork);
        this.topic = peerNetwork.meshId;
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

        
        //FIXME: this works with events now, right?
        this.gossipAgent?.localAgentStateUpdate(this.getAgentId(), this.state);
    }


    ready(pod: AgentPod): void {
        this.pod = pod;
        this.gossipAgent = pod.getAgent(StateGossipAgent.agentIdForGossip(this.topic)) as StateGossipAgent;
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

            let state = HashedObject.fromLiteral(m.state) as LinearState;

            this.receiveRemoteState(sender, state.hash(), state);
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

        this.peerMesh.sendToPeer(endpoint, this.getAgentId(), requestStateMessage);
    }

    sendState(endpoint: Endpoint) {
        let sendStateMessage : SendStateMessage = {
            type: MessageType.SendState,
            state: (this.state as LinearState).toLiteral()
        }

        this.peerMesh.sendToPeer(endpoint, this.getAgentId(), sendStateMessage);
    }

}

export { LinearStateAgent }