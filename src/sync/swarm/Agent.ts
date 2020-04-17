import { Swarm, Event, Message, PeerMessage } from 'sync/swarm';

interface Agent {
    getId() : string;

    ready(swarm: Swarm) : void;

    receiveLocalEvent(ev: Event) : void;
    receiveMessage(message: Message) : void;
    receivePeerMessage(message: PeerMessage) : void;
}

export { Agent };