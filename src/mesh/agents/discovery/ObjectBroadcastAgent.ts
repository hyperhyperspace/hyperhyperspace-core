import { Agent, AgentId } from 'mesh/service/Agent';
import { AgentPod, AgentEvent } from 'mesh/service/AgentPod';

import { Endpoint, NetworkAgent, NetworkEventType, LinkupMessage } from 'mesh/agents/network/NetworkAgent';
import { Hash, HashedObject, Hashing, LiteralContext } from 'data/model';
import { LinkupAddress } from 'net/linkup';
import { Logger, LogLevel } from 'util/logging';
import { MultiMap } from 'util/multimap';

type ObjectBroadcastRequest = {
    hashSuffix:  string,
    agentId: AgentId
}

type ObjectBroadcastReply = {
    source: Endpoint,
    literalContext: LiteralContext
}

class ObjectBroadcastAgent implements Agent {

    static log = new Logger(ObjectBroadcastAgent.name, LogLevel.DEBUG);

    static defaultBroadcastedSuffixBits = 36;

    static agentIdForHash(hash: Hash, suffixBits = this.defaultBroadcastedSuffixBits) {
        return ObjectBroadcastAgent.agentIdForHexHashSuffix(Hashing.toHex(hash), suffixBits);
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

    literalContext: LiteralContext;
    listening: MultiMap<string, Endpoint>;


    constructor(object: HashedObject, broadcastedSuffixBits?: number) {
        if (broadcastedSuffixBits === undefined) {
            broadcastedSuffixBits = ObjectBroadcastAgent.defaultBroadcastedSuffixBits;
        }

        this.literalContext = object.toLiteralContext();
        this.listening = new MultiMap();
        this.broadcastedSuffixBits = broadcastedSuffixBits;
    }


    getAgentId(): string {
        return ObjectBroadcastAgent.agentIdForHash(this.literalContext.rootHashes[0], this.broadcastedSuffixBits);
    }
    
    ready(pod: AgentPod): void {
        
        this.pod = pod;

        for (const linkupServer of this.listening.keys()) {
            this.createListener(linkupServer);    
        }   

        ObjectBroadcastAgent.log.debug('Started ObjectBroadcastAgent for ' + this.literalContext.rootHashes[0] + ', broadcasted bits: ' + this.broadcastedSuffixBits);
    }

    listenOn(linkupServers: string[], replyEndpoints: Endpoint[]) {

        for (const linkupServer of linkupServers) {
            for (const replyEndpoint of replyEndpoints) {
                this.listening.add(linkupServer, replyEndpoint);
                ObjectBroadcastAgent.log.trace('Listening on ' + linkupServer + ' with replyEndpoint=' + replyEndpoint);
            }

            if (this.pod !== undefined) {
                this.createListener(linkupServer);
            }
        }
    }
    
    private createListener(linkupServer: string) {

        const networkAgent = this.getNetworkAgent();
        
        const broadcastLinkupId = ObjectBroadcastAgent.linkupIdForHexHashSuffix(ObjectBroadcastAgent.hexSuffixFromHash(this.literalContext.rootHashes[0], this.broadcastedSuffixBits));
        let address = new LinkupAddress(linkupServer, broadcastLinkupId);
        networkAgent.listenForLinkupMessages(address.url());
        ObjectBroadcastAgent.log.trace(() => 'Listening for linkup messages on ' + address.url()) + ' for ' + this.literalContext.rootHashes[0];

    }

    receiveLocalEvent(ev: AgentEvent): void {

        const MIN_BITS_TO_ANSWER = 36;

        if (ev.type === NetworkEventType.LinkupMessageReceived) {
            const msg = ev.content as LinkupMessage;

            if (msg.agentId === this.getAgentId()) {

                

                const req = msg.content as ObjectBroadcastRequest;

                ObjectBroadcastAgent.log.trace(() => 'Received object broadcast query for ' + req.hashSuffix + ' (match: ' + this.hashSuffixMatch(req.hashSuffix) + ')');

                if (req.hashSuffix.length * 4 >= MIN_BITS_TO_ANSWER && this.hashSuffixMatch(req.hashSuffix)) {
                    
                    const networkAgent = this.getNetworkAgent();
                    const dstAddress = LinkupAddress.fromURL(msg.destination);

                    for (const replyEndpoint of this.listening.get(dstAddress.serverURL)) {

                        if (msg.source !== replyEndpoint) {
                            ObjectBroadcastAgent.log.debug('Answering query from ' + msg.source + ' for suffix ' + req.hashSuffix + ' from endpoint ' + replyEndpoint);
                            const reply: ObjectBroadcastReply = {
                                source: replyEndpoint,
                                literalContext: this.literalContext
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
    }
    
    shutdown(): void {
        // TODO: stop listening on the linkup addresses
    }

    private hashSuffixMatch(suffix: string): boolean {
        //const receivedBits = suffix.length * 4;

        let ownSuffix = Hashing.toHex(this.literalContext.rootHashes[0]).slice(-suffix.length);

        return ownSuffix === suffix;
    }

    // shorthand functions

    private getNetworkAgent() {
        return this.pod?.getAgent(NetworkAgent.AgentId) as NetworkAgent;
    }

}

export { ObjectBroadcastAgent, ObjectBroadcastRequest, ObjectBroadcastReply };