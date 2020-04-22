import { Swarm, Event, Message, PeerMessage } from 'sync/swarm';

type AgentId = string;

interface Agent {
    getId() : AgentId;

    ready(swarm: Swarm) : void;

    receiveLocalEvent(ev: Event) : void;
    receiveMessage(message: Message) : void;
    receivePeerMessage(message: PeerMessage) : void;
}

export { Agent, AgentId };