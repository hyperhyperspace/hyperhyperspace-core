
import { Agent } from 'mesh/service/Agent';
import { AgentPod, Event } from 'mesh/service/AgentPod';

import { Endpoint, NetworkAgent } from 'mesh/agents/network/NetworkAgent';
import { HashedObject } from 'data/model';


enum OperatingMode {
    inactive     = 'inactive',
    standby      = 'standby',
    discoverable = 'discoverable'
};

class PeerDiscoveryAgent implements Agent {

    static agentIdForDiscoveryToken(token: string) {
        return 'peer-discovery-for-' + token;
    }

    pod?: AgentPod;

    mode: OperatingMode;

    discoveryToken: string;
    providedEndpoints: Endpoint[];
    providedObjects: HashedObject[];

    constructor(discoveryToken: string, providedEndpoints: Endpoint[], providedObjects: HashedObject[]) {
        this.mode = OperatingMode.inactive;

        this.discoveryToken    = discoveryToken;
        this.providedEndpoints = providedEndpoints;
        this.providedObjects   = providedObjects;
    }


    getAgentId(): string {
        return PeerDiscoveryAgent.agentIdForDiscoveryToken(this.discoveryToken);
    }
    
    ready(pod: AgentPod): void {
        this.pod = pod;

        this.init();
    }

    private async init() {

        const networkAgent = this.getNetworkAgent();

        networkAgent.listen(this.localPeer.endpoint);
    
    }
    
    receiveLocalEvent(ev: Event): void {
        throw new Error('Method not implemented.');
    }
    
    shutdown(): void {
        throw new Error('Method not implemented.');
    }

    // shorthand functions

    private getNetworkAgent() {
        return this.pod?.getAgent(NetworkAgent.AgentId) as NetworkAgent;
    }

    private 

}

export { PeerDiscoveryAgent };