
import { Agent, AgentId } from 'mesh/service/Agent';
import { AgentPod, Event } from 'mesh/service/AgentPod';

import { Endpoint, NetworkAgent, NetworkEventType, LinkupMessage } from 'mesh/agents/network/NetworkAgent';
import { Hash, HashedObject, HashReference } from 'data/model';
import { LinkupAddress, LinkupManager } from 'net/linkup';


enum OperatingMode {
    inactive     = 'inactive',
    broadcasting = 'broadcasting',
    standby      = 'standby'
};

type SpaceBroadcastRequest = {
    prefix:  string,
    agentId: AgentId
}

type SpaceBroadcastReply = {
    rootHash: Hash,
    rootClassName: string,
    peers: Endpoint[]
}

class SpaceBroadcastAgent implements Agent {

    static agentIdForRootHash(rootHash: Hash) {
        return 'space-broadcast-for-' + rootHash;
    }

    static linkupIdForHashPrefix(prefix: string) {
        return 'space-boot-' + prefix;
    }

    pod?: AgentPod;

    mode: OperatingMode;
    rootRef: HashReference<HashedObject>;
    peers: Endpoint[];
    prefixes: string[];
    targetLinkupServers: string[];

    constructor(rootRef: HashReference<HashedObject>, peers: Endpoint[], targetLinkupServers=[LinkupManager.defaultLinkupServer], prefixBits = [36, 48]) {
        this.mode = OperatingMode.broadcasting;
        this.rootRef = rootRef;
        this.peers = peers;
        this.targetLinkupServers = targetLinkupServers;
        this.prefixes = prefixBits.map((bits: number) => this.rootRef.hash.slice(0, bits/4));
    }


    getAgentId(): string {
        return SpaceBroadcastAgent.agentIdForRootHash(this.rootRef.hash);
    }
    
    ready(pod: AgentPod): void {
        this.pod = pod;

        this.init();
    }

    private async init() {

        const networkAgent = this.getNetworkAgent();

        for (const linkupServer of this.targetLinkupServers) {
            for (const prefix of this.prefixes) {
                let address = new LinkupAddress(linkupServer, SpaceBroadcastAgent.linkupIdForHashPrefix(prefix));
                networkAgent.listenForLinkupMessages(address.url());
            }
            
        }    
    }
    
    receiveLocalEvent(ev: Event): void {
        if (ev.type === NetworkEventType.LinkupMessageReceived) {
            const msg = ev.content as LinkupMessage;

            const req = msg.content as SpaceBroadcastRequest;

            if (this.prefixes.indexOf(req.prefix) >= 0) {

                const reply: SpaceBroadcastReply = {
                    rootHash: this.rootRef.hash,
                    rootClassName: this.rootRef.className,
                    peers: this.peers
                };

                const networkAgent = this.getNetworkAgent();

                networkAgent.sendLinkupMessage(
                    LinkupAddress.fromURL(msg.destination), 
                    LinkupAddress.fromURL(msg.source), 
                    req.agentId, 
                    reply
                );
            }

        }
    }
    
    shutdown(): void {
        // TODO: stop listening on the linkup addresses
    }

    // shorthand functions

    private getNetworkAgent() {
        return this.pod?.getAgent(NetworkAgent.AgentId) as NetworkAgent;
    }

}

export { SpaceBroadcastAgent };