import { Peer, Endpoint, CallId } from 'sync/swarm';


// a naive peer

class TestPeer implements Peer {

    id: string;
    endpoint: Endpoint;
    callId?: CallId;

    constructor(id: string, endpoint: Endpoint, callId?: CallId) {

        this.id       = id;
        this.endpoint = endpoint;
        this.callId   = callId;
    }

    getId(): string {
        return this.id;
    }
    
    getCallId(): string {
        if (this.callId === undefined) {
            throw new Error("Peer " + this.id + " is not associated to a callId.");
        }
        return this.callId;
    }
    
    getEndpoint(): string {
        return this.endpoint;
    }
    
}

export { TestPeer };