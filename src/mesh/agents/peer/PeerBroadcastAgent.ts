
import { Agent, AgentId } from 'mesh/service/Agent';
import { AgentPod, Event } from 'mesh/service/AgentPod';

import { Endpoint, NetworkAgent, NetworkEventType, LinkupMessage } from 'mesh/agents/network/NetworkAgent';
import { Hash } from 'data/model';
import { LinkupAddress, LinkupManager } from 'net/linkup';
import { Logger, LogLevel } from 'util/logging';


enum OperatingMode {
    inactive     = 'inactive',
    broadcasting = 'broadcasting',
    standby      = 'standby'
};

type PeerBroadcastRequest = {
    suffix:  string,
    agentId: AgentId
}

type PeerBroadcastReply = {
    hash: Hash,
    peers: Endpoint[],
    extraInfo?: any
}

const DEFAULT_SUFFIX_BITS = 36;

class PeerBroadcastAgent implements Agent {

    static log = new Logger(PeerBroadcastAgent.name, LogLevel.TRACE);

    static getSuffix(hash: string, suffixBits=DEFAULT_SUFFIX_BITS): string {
        
        if (suffixBits % 4 !== 0) {
            throw new Error('PeerBroadcastAgent: suffixBits needs to be ' + 
                            'a multiple of 4 (received ' + suffixBits + ')');
        }

        const suffixNibbles = suffixBits/4;

        return hash.slice(-suffixNibbles);
    }

    static agentIdForHashSuffix(suffix: string) {
        return 'peer-broadcast-for-' + suffix;
    }

    static linkupIdForHashSuffix(suffix: string) {
        return 'peer-request-for-' + suffix;
    }

    pod?: AgentPod;

    mode: OperatingMode;
    hash: Hash;
    peers: Endpoint[];
    hashSuffix: string;
    targetLinkupServers: string[];
    extraInfo?: any;

    constructor(hash: Hash, peers: Endpoint[], targetLinkupServers=[LinkupManager.defaultLinkupServer], suffixBits = 36, extraInfo?: any) {
        this.mode = OperatingMode.broadcasting;
        this.hash = hash;
        this.peers = peers;
        this.extraInfo = extraInfo;
        this.targetLinkupServers = targetLinkupServers;
        this.hashSuffix = PeerBroadcastAgent.getSuffix(this.hash, suffixBits);
    }


    getAgentId(): string {
        return PeerBroadcastAgent.agentIdForHashSuffix(this.hashSuffix);
    }
    
    ready(pod: AgentPod): void {
        this.pod = pod;

        this.init();
        PeerBroadcastAgent.log.debug('Started broadcasting peers ' + this.peers + ' for suffix ' + this.hashSuffix + ' on ' + this.targetLinkupServers);
    }

    private async init() {

        const networkAgent = this.getNetworkAgent();

        for (const linkupServer of this.targetLinkupServers) {
            const broadcastLinkupId = PeerBroadcastAgent.linkupIdForHashSuffix(this.hashSuffix);
            let address = new LinkupAddress(linkupServer, broadcastLinkupId);
            networkAgent.listenForLinkupMessages(address.url());
            PeerBroadcastAgent.log.trace(() => 'Listening for linkup messages on ' + address.url());
        }    
    }
    
    receiveLocalEvent(ev: Event): void {
        if (ev.type === NetworkEventType.LinkupMessageReceived) {
            const msg = ev.content as LinkupMessage;

            const req = msg.content as PeerBroadcastRequest;

            if (this.hashSuffix === req.suffix) {

                PeerBroadcastAgent.log.debug('Answering query from ' + msg.source + ' for suffix ' + this.hashSuffix + ' with endpoints ' + this.peers);
                const reply: PeerBroadcastReply = {
                    hash: this.hash,
                    peers: this.peers
                };

                if (this.extraInfo !== undefined) {
                    reply.extraInfo = this.extraInfo;
                }

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

export { PeerBroadcastAgent, PeerBroadcastRequest, PeerBroadcastReply };