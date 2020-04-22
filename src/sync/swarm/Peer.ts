import { CallId, Endpoint } from './Swarm';

type PeerId  = string;

interface Peer {
    getId() : PeerId;
    getCallId() : CallId;
    getEndpoint() : Endpoint;
}

export { Peer, PeerId };