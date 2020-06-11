import { Network, Event } from './Pod';

type AgentId = string;

interface Agent {

    getAgentId() : AgentId;

    ready(pod: Network) : void;

    receiveLocalEvent(ev: Event) : void;
}

export { Agent, AgentId };