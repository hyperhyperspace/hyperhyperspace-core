import { Agent, Swarm, Event, Message, PeerMessage } from 'sync/swarm';

class NullAgent implements Agent {
    getId(): string {
        return 'null-agent';
    }
    ready(_swarm: Swarm): void {
        
    }
    receiveLocalEvent(_ev: Event): void {

    }
    receiveMessage(_message: Message): void {
        
    }
    receivePeerMessage(_message: PeerMessage): void {

    }

}

export { NullAgent };