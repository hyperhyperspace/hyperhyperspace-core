import { ServicePod, Event } from './ServicePod';

type AgentId = string;

interface Agent {

    getAgentId() : AgentId;

    ready(pod: ServicePod) : void;

    receiveLocalEvent(ev: Event) : void;
}

export { Agent, AgentId };