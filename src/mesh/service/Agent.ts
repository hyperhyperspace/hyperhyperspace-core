import { AgentPod, AgentEvent } from './AgentPod';

type AgentId = string;

interface Agent {

    getAgentId() : AgentId;

    ready(pod: AgentPod) : void;

    receiveLocalEvent(ev: AgentEvent) : void;

    shutdown() : void;
}

export { Agent, AgentId };