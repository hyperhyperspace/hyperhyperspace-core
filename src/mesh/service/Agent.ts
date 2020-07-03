import { AgentPod, Event } from './AgentPod';

type AgentId = string;

interface Agent {

    getAgentId() : AgentId;

    ready(pod: AgentPod) : void;

    receiveLocalEvent(ev: Event) : void;
}

export { Agent, AgentId };