import { StateAgent } from 'sync/agents/state/StateAgent';
import { Swarm, Event, Message, PeerMessage } from 'sync/swarm';
import { HashedObject, Hash } from 'data/model';
import { StateGossipAgent } from 'sync/agents/state/StateGossipAgent';
import { PeerId } from 'sync/swarm/Peer';
import { Logger, LogLevel } from 'util/logging';


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

class LinearStateAgent implements StateAgent {

    static logger = new Logger(LinearState.name, LogLevel.INFO);

    static createId(id: string) {
        return 'linear-state-agent-' + id;
    }

    id: string;

    swarm?: Swarm;
    gossipAgent?: StateGossipAgent;

    seq?: number;
    message?: string;

    state?: LinearState;
    prevStates : Set<Hash>;

    constructor(id: string) {
        this.id = id;
        this.prevStates = new Set();
    }

    getId(): string {
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

        

        this.gossipAgent?.localAgentStateUpdate(this.getId(), this.state);
    }


    ready(swarm: Swarm): void {
        this.swarm = swarm;
        this.gossipAgent = swarm.getLocalAgent(StateGossipAgent.Id) as StateGossipAgent;
    }

    receiveLocalEvent(ev: Event): void {
        ev;
        // ignore
    }

    receiveMessage(message: Message): void {
        message;
        // ignore
    }

    receivePeerMessage(message: PeerMessage): void {

        console.log(message);

        let m = message.content as LinearStateMessage;

        if (m.type === MessageType.RequestState) {
            this.sendState(message.sourceId);
        }

        if (m.type === MessageType.SendState) {
            this.receiveRemoteState(message.sourceId, m.state.hash(), m.state);
        }
    }

    async receiveRemoteState(sender: string, stateHash: string, state?: HashedObject): Promise<boolean> {

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

    private requestState(peerId: PeerId) {
        let requestStateMessage : RequestStateMessage = {
            type: MessageType.RequestState
        }

        let peerMessage : PeerMessage = {
            sourceId      : this.swarm?.getLocalPeer().getId() as PeerId,
            destinationId : peerId,
            agentId       : this.getId(),
            content       : requestStateMessage
        };

        this.swarm?.sendPeerMessage(peerMessage);

    }

    private sendState(peerId: PeerId) {
        let sendStateMessage : SendStateMessage = {
            type: MessageType.SendState,
            state: this.state as LinearState
        }

        let peerMessage : PeerMessage = {
            sourceId      : this.swarm?.getLocalPeer().getId() as PeerId,
            destinationId : peerId,
            agentId       : this.getId(),
            content       : sendStateMessage
        };

        this.swarm?.sendPeerMessage(peerMessage);
    }

}

export { LinearStateAgent }