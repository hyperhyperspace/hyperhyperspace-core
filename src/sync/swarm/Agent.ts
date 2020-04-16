import { Event, Message, PeerMessage } from './Swarm';

interface Agent {
    getId() : string;
    receiveLocalEvent(ev: Event) : void;
    receiveMessage(message: Message) : void;
    receivePeerMessage(message: PeerMessage) : void;
}

export { Agent };