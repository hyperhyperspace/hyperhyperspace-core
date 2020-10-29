import { Agent, AgentId } from 'mesh/service/Agent';
import { AgentPod, Event } from 'mesh/service/AgentPod';

import { Endpoint, NetworkAgent, NetworkEventType, LinkupMessage } from 'mesh/agents/network/NetworkAgent';
import { Hash, HashedObject, Hashing, Literal } from 'data/model';
import { LinkupAddress } from 'net/linkup';
import { Logger, LogLevel } from 'util/logging';
import { MultiMap } from 'util/multimap';

type ObjectBroadcastRequest = {
    hashSuffix:  string,
    agentId: AgentId
}

type ObjectBroadcastReply = {
    source: Endpoint,
    literal: Literal
}

class ObjectBroadcastAgent implements Agent {

    static log = new Logger(ObjectBroadcastAgent.name, LogLevel.INFO);

    static defaultBroadcastedSuffixBits = 36;

    static agentIdForHash(hash: Hash, suffixBits = this.defaultBroadcastedSuffixBits) {
        return ObjectBroadcastAgent.agentIdForHexHashSuffix(Hashing.toHex(hash), suffixBits);
        return 'object-broadcast-agent-for-' + ObjectBroadcastAgent.hexSuffixFromHash(hash, suffixBits);
    }

    static agentIdForHexHashSuffix(hexSuffix: string, suffixBits = this.defaultBroadcastedSuffixBits) {
        return 'object-broadcast-agent-for-' + ObjectBroadcastAgent.trimHexSuffix(hexSuffix, suffixBits);
    }

    static hexSuffixFromHash(hash: string, suffixBits: number): string {
        return ObjectBroadcastAgent.trimHexSuffix(Hashing.toHex(hash), suffixBits);
    }

    static trimHexSuffix(hashSuffix: string, suffixBits: number) {
        if (suffixBits % 4 !== 0) {
            throw new Error('ObjectBroadcastAgent: suffixBits needs to be ' + 
                            'a multiple of 4 (received ' + suffixBits + ')');
        }

        const suffixNibbles = suffixBits/4;

        return hashSuffix.slice(-suffixNibbles);
    }

    static linkupIdForHexHashSuffix(hexSuffix: string) {
        return 'broadcast-' + hexSuffix;
    }

    pod?: AgentPod;

    broadcastedSuffixBits: number;

    literal: Literal;
    listening: MultiMap<string, Endpoint>;


    constructor(object: HashedObject, broadcastedSuffixBits?: number) {
        if (broadcastedSuffixBits === undefined) {
            broadcastedSuffixBits = ObjectBroadcastAgent.defaultBroadcastedSuffixBits;
        }

        this.literal = object.toLiteral();
        this.listening = new MultiMap();
        this.broadcastedSuffixBits = broadcastedSuffixBits;
    }


    getAgentId(): string {
        return ObjectBroadcastAgent.agentIdForHash(this.literal.hash, this.broadcastedSuffixBits);
    }
    
    ready(pod: AgentPod): void {
        
        this.pod = pod;

        for (const linkupServer of this.listening.keys()) {
            this.createListener(linkupServer);    
        }   

        ObjectBroadcastAgent.log.debug('Started ObjectBroadcastAgent for ' + this.literal.hash);
    }

    listenOn(linkupServers: string[], replyEndpoints: Endpoint[]) {
        for (const linkupServer of linkupServers) {
            for (const replyEndpoint of replyEndpoints) {
                this.listening.add(linkupServer, replyEndpoint);
            }

            if (this.pod !== undefined) {
                this.createListener(linkupServer);
            }
        }
    }
    
    private createListener(linkupServer: string) {

        const networkAgent = this.getNetworkAgent();
        
        const broadcastLinkupId = ObjectBroadcastAgent.linkupIdForHexHashSuffix(ObjectBroadcastAgent.hexSuffixFromHash(this.literal.hash, this.broadcastedSuffixBits));
        let address = new LinkupAddress(linkupServer, broadcastLinkupId);
        networkAgent.listenForLinkupMessages(address.url());
        ObjectBroadcastAgent.log.trace(() => 'Listening for linkup messages on ' + address.url());

    }

    receiveLocalEvent(ev: Event): void {

        const MIN_BITS_TO_ANSWER = 36;

        if (ev.type === NetworkEventType.LinkupMessageReceived) {
            const msg = ev.content as LinkupMessage;

            if (msg.agentId === this.getAgentId()) {

                ObjectBroadcastAgent.log.trace('Received object broadcast query');

                const req = msg.content as ObjectBroadcastRequest;

                if (req.hashSuffix.length * 4 >= MIN_BITS_TO_ANSWER && this.hashSuffixMatch(req.hashSuffix)) {
                    
                    const networkAgent = this.getNetworkAgent();
                    const dstAddress = LinkupAddress.fromURL(msg.destination);

                    for (const replyEndpoint of this.listening.get(dstAddress.serverURL)) {
                        ObjectBroadcastAgent.log.debug('Answering query from ' + msg.source + ' for suffix ' + req.hashSuffix + ' from endpoint ' + replyEndpoint);
                        const reply: ObjectBroadcastReply = {
                            source: replyEndpoint,
                            literal: this.literal
                        };

                        networkAgent.sendLinkupMessage(
                            LinkupAddress.fromURL(replyEndpoint), 
                            LinkupAddress.fromURL(msg.source), 
                            req.agentId, 
                            reply
                        );
                    }
                }
            }
            

        }
    }
    
    shutdown(): void {
        // TODO: stop listening on the linkup addresses
    }

    private hashSuffixMatch(suffix: string): boolean {
        const receivedBits = suffix.length * 4;

        let ownSuffix = Hashing.toHex(this.literal.hash).slice(-receivedBits);

        return ownSuffix === suffix;
    }

    // shorthand functions

    private getNetworkAgent() {
        return this.pod?.getAgent(NetworkAgent.AgentId) as NetworkAgent;
    }

}

export { ObjectBroadcastAgent, ObjectBroadcastRequest, ObjectBroadcastReply };