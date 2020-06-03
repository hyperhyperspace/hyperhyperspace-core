import { Network, Event, ConnectionId, Endpoint } from './Network';

type AgentId = string;

interface Agent {
    getAgentId() : AgentId;

    ready(network: Network) : void;

    receiveLocalEvent(ev: Event) : void;
    receiveMessage(connId: ConnectionId, source: Endpoint, destination: Endpoint, content: any) : void;
}

export { Agent, AgentId };