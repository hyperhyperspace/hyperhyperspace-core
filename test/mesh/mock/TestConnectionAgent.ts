import { Endpoint, ConnectionId, NetworkEventType, 
        ConnectionStatusChangeEvent, ConnectionStatus, NetworkAgent, MessageReceivedEvent } from 'mesh/agents/network';
import { AgentPod, Event } from 'mesh/services';
import { Agent } from 'mesh/services';
import { MultiMap } from 'util/multimap';


class TestConnectionAgent implements Agent {

    pod?: AgentPod;
    networkAgent?: NetworkAgent;
    connecting: MultiMap<Endpoint, Endpoint>;                     // local -> remotes
    established: Map<Endpoint, MultiMap<Endpoint, ConnectionId>>; // local -> remote -> connections
    receivedMessages: Map<Endpoint, MultiMap<Endpoint, string>>;  // local -> remote -> messages

    constructor() {
        this.connecting = new MultiMap();
        this.established = new Map();
        this.receivedMessages = new Map();
    }

    getAgentId(): string {
        return 'test-conn-agent';
    }

    ready(pod: AgentPod): void {
        this.pod = pod;
        this.networkAgent = pod.getAgent(NetworkAgent.AgentId) as NetworkAgent;
    }

    expectConnection(source: Endpoint, destination: Endpoint) {
        this.connecting.add(destination, source);
        this.networkAgent?.listen(destination);
    }

    connect(source: Endpoint, destination: Endpoint) {
        this.connecting.add(source, destination);
        this.networkAgent?.connect(source, destination, this.getAgentId());
    }

    isConnected(local: Endpoint, remote: Endpoint) {
        let size = this.established.get(local)?.get(remote)?.size;
        return size !== undefined && size > 0;
    }

    send(local: Endpoint, remote: Endpoint, message: string): boolean {
        if (this.isConnected(local, remote)) {
            for (let connId of (this.established.get(local) as MultiMap<Endpoint, ConnectionId>).get(remote)) {
                if (this.networkAgent?.connectionIsReady(connId)) {
                    this.networkAgent?.sendMessage(connId, this.getAgentId(), message);
                    
                    return true;
                }
                
            }   
        }

        return false;
    }

    getReceivedMessages(source: Endpoint, destination: Endpoint) : Set<string> {
        let msgsForEP = this.receivedMessages.get(destination);

        if (msgsForEP === undefined) {
            return new Set<string>();
        } else {
            return msgsForEP.get(source);
        }
    }

    receiveLocalEvent(ev: Event): void {
        if (ev.type === NetworkEventType.ConnectionStatusChange) {
            let connEv = ev as ConnectionStatusChangeEvent;

            if (connEv.content.status === ConnectionStatus.Received) {
                let remotes = this.connecting.get(connEv.content.localEndpoint);
                if (remotes?.has(connEv.content.remoteEndpoint)) {
                    this.networkAgent?.acceptConnection(connEv.content.connId, this.getAgentId());
                }
            } else if (connEv.content.status === ConnectionStatus.Ready) {
                if (this.connecting.get(connEv.content.localEndpoint).has(connEv.content.remoteEndpoint)) {
                    
                    let establishedForLocalEP = this.established.get(connEv.content.localEndpoint);
                    if (establishedForLocalEP === undefined) {
                        establishedForLocalEP = new MultiMap();
                        this.established.set(connEv.content.localEndpoint, establishedForLocalEP);
                    }
                    establishedForLocalEP.add(connEv.content.remoteEndpoint, connEv.content.connId);

                    this.connecting.get(connEv.content.localEndpoint).delete(connEv.content.remoteEndpoint);
                }
                
            } else if (connEv.content.status === ConnectionStatus.Closed) {
                this.established.get(connEv.content.localEndpoint)?.delete(connEv.content.remoteEndpoint, connEv.content.connId);
            }
        } else if (ev.type === NetworkEventType.MessageReceived) {
            let msgEv = ev as MessageReceivedEvent;
            this.receiveMessage(msgEv.content.connectionId , msgEv.content.source, msgEv.content.destination, msgEv.content.content);
        }
    }

    receiveMessage(connId: string, source: string, destination: string, content: any): void {
        connId;
        let msgsLocalEP = this.receivedMessages.get(destination);
        if (msgsLocalEP === undefined) {
            msgsLocalEP = new MultiMap();
            this.receivedMessages.set(destination, msgsLocalEP);
        }
        
        msgsLocalEP.add(source, content);
    }

}

export { TestConnectionAgent };