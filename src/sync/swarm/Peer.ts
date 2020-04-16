import { CallId, Endpoint } from './Swarm';


interface Peer {
    getId() : string;
    getCallId() : CallId;
    getEndpoint() : Endpoint;
}

export { Peer };