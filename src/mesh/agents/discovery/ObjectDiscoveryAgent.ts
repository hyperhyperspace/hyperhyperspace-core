import { Hash, HashedObject, Hashing, LiteralUtils } from 'data/model';
import { AgentPod, AgentEvent } from 'mesh/service/AgentPod';
import { LinkupAddress } from 'net/linkup';
import { Logger, LogLevel } from 'util/logging';
import { Agent } from '../../service/Agent';
import { Endpoint, LinkupMessage, NetworkAgent, NetworkEventType } from '../network/NetworkAgent';
import { ObjectBroadcastAgent, ObjectBroadcastRequest, ObjectBroadcastReply } from './ObjectBroadcastAgent';

import { AsyncStream, BufferedAsyncStream, BufferingAsyncStreamSource, AsyncStreamSource, FilteredAsyncStreamSource } from 'util/streams';

type Params = {
    broadcastedSuffixBits : number,
    maxQueryFreq          : number,
    maxStoredReplies      : number
};

type ObjectDiscoveryReply = { source: Endpoint, destination: Endpoint, hash: Hash, object?: HashedObject, error?: string, timestamp: number };

type ObjectDiscoveryReplyParams = {maxAge?: number, linkupServers?: string[], localEndpoints?: Endpoint[], includeErrors?: boolean};

class ObjectDiscoveryAgent implements Agent {

    static log = new Logger(ObjectDiscoveryAgent.name, LogLevel.DEBUG);

    static agentIdForHexHashSuffix(suffix: string) {
        return 'object-discovery-for-' + suffix;
    }

    static newestReplyFirst = (a: ObjectDiscoveryReply, b: ObjectDiscoveryReply) => (b.timestamp - a.timestamp);

    pod?: AgentPod;

    
    hexHashSuffix: string;
    params: Params;

    localEndpoints: Set<Endpoint>;
    lastQueryingTimePerServer: Map<string, number>;

    streamSource: BufferingAsyncStreamSource<ObjectDiscoveryReply>;


    wasShutdown = false;

    constructor(hexHashSuffix: string, params?: Partial<Params>) {
        
        this.hexHashSuffix = hexHashSuffix;

        if (params === undefined) {
            params = { };
        }

        this.params = {
            broadcastedSuffixBits: params?.broadcastedSuffixBits === undefined? ObjectBroadcastAgent.defaultBroadcastedSuffixBits : params.broadcastedSuffixBits,
            maxQueryFreq: params?.maxQueryFreq === undefined ? 2 : params.maxQueryFreq,
            maxStoredReplies: params?.maxStoredReplies === undefined? 15 : params.maxStoredReplies
        };

        this.localEndpoints = new Set();
        this.lastQueryingTimePerServer = new Map();

        this.streamSource = new BufferingAsyncStreamSource(this.params.maxStoredReplies);
    }

    getAgentId(): string {
        return ObjectDiscoveryAgent.agentIdForHexHashSuffix(this.hexHashSuffix);
    }

    ready(pod: AgentPod): void {
        this.pod = pod;
    }

    query(linkupServers: string[], localAddress: LinkupAddress, count=1) {

        if (this.pod === undefined) {
            throw new Error('This ObjectDiscoveryAgent has not been registered to a mesh so it cannot accept queries yet.');
        }

        if (this.wasShutdown) {
            throw new Error('This ObjectDiscoveryAgent was shut down, it cannot accept more queries.');
        }
        const currentTime = Date.now();

        const request: ObjectBroadcastRequest = {
            hashSuffix: this.hexHashSuffix,
            agentId: this.getAgentId()
            
        }

        const localEndpoint = localAddress.url();
        const localIdentity = localAddress.identity;

        if (!this.localEndpoints.has(localEndpoint)) {
            ObjectDiscoveryAgent.log.trace('listening on ' + localEndpoint);
            this.getNetworkAgent().listenForLinkupMessages(localEndpoint, localIdentity);
            this.localEndpoints.add(localEndpoint);
        }


        for (const linkupServer of linkupServers) {
            const lastQueryingTime = this.lastQueryingTimePerServer.get(linkupServer);

            if (lastQueryingTime === undefined ||
                currentTime >= lastQueryingTime + this.params.maxQueryFreq * 1000) {
                

                this.lastQueryingTimePerServer.set(linkupServer, currentTime);

                    
                const broadcasted = ObjectBroadcastAgent.trimHexSuffix(this.hexHashSuffix, this.params.broadcastedSuffixBits);

                ObjectDiscoveryAgent.log.trace(() => 
                    'Sending peer query from endpoint ' + 
                    localEndpoint + 
                    ' to endpoint ' + 
                    new LinkupAddress(linkupServer, ObjectBroadcastAgent.linkupIdForHexHashSuffix(broadcasted)).url() +
                    ' for suffix ' + this.hexHashSuffix);
                
                this.getNetworkAgent().sendLinkupMessage(
                    LinkupAddress.fromURL(localEndpoint),
                    new LinkupAddress(linkupServer, ObjectBroadcastAgent.linkupIdForHexHashSuffix(broadcasted)),
                    ObjectBroadcastAgent.agentIdForHexHashSuffix(this.hexHashSuffix, this.params.broadcastedSuffixBits),
                    request,
                    Math.ceil(count * 1.5)
                );
            } else {
                ObjectDiscoveryAgent.log.trace(() => 'Object discovery query ignored for server ' + linkupServer + ', we queried too recently there.');
            }
        }
    }

    getReplyStream(filterParams?: ObjectDiscoveryReplyParams) : AsyncStream<ObjectDiscoveryReply> {

        let source: AsyncStreamSource<ObjectDiscoveryReply> = this.streamSource; 

        const maxAge         = filterParams?.maxAge;
        const linkupServers  = filterParams?.linkupServers;
        const localEndpoints = filterParams?.localEndpoints;
        const includeErrors  = filterParams?.includeErrors || false;

        if (maxAge !== undefined ||
            linkupServers !== undefined ||
            localEndpoints !== undefined || 
            !includeErrors) {

            let filter = (elem: ObjectDiscoveryReply) => {

                let now = Date.now();
                let accept = true;
                
                accept = accept && (maxAge === undefined || elem.timestamp >= now - maxAge * 1000);
                accept = accept && (linkupServers === undefined || linkupServers.indexOf(LinkupAddress.fromURL(elem.source).serverURL) >= 0);
                accept = accept && (localEndpoints === undefined || localEndpoints.indexOf(elem.destination) >= 0);
                accept = accept && (includeErrors || elem.error === undefined);

                return accept;
            }
            
            source = new FilteredAsyncStreamSource<ObjectDiscoveryReply>(source, filter);
        }

        return new BufferedAsyncStream(source);;
    }

    receiveLocalEvent(ev: AgentEvent): void {

        if (! this.wasShutdown && ev.type === NetworkEventType.LinkupMessageReceived) {
            const msg = ev.content as LinkupMessage;

            if (msg.agentId === this.getAgentId()) {

                const reply = msg.content as ObjectBroadcastReply;

                

                let replyHash: Hash|undefined = undefined;
                let object: HashedObject | undefined = undefined;
                let error: string | undefined = undefined;
                try {
                    object = HashedObject.fromLiteralContext(reply.literalContext);
                    replyHash = object.hash();
                } catch (e: any) {

                    // Since anybody may reply with _anything_, only replies that at least match the hash
                    // suffix being queried will be reported back to the caller.

                    ObjectDiscoveryAgent.log.warning('Error deliteralizing object discovery reply:' + e);
                    object = undefined;
                    replyHash = undefined;
                    const literal = reply.literalContext.literals[reply.literalContext.rootHashes[0]];

                    if (literal !== undefined && LiteralUtils.validateHash(literal)) {
                        if (literal.hash === reply.literalContext.rootHashes[0]) {
                            replyHash = literal.hash;
                        }
                    }

                    error = String(e);
                }

                if (replyHash === reply.literalContext.rootHashes[0] && 
                    this.hexHashSuffix === Hashing.toHex(replyHash).slice(-this.hexHashSuffix.length) &&
                    this.localEndpoints.has(msg.destination)) {

                    ObjectDiscoveryAgent.log.trace(() => 'Received object with hash ' + replyHash + ' from ' + msg.source + ' at ' + msg.destination);

                    let item = {source: msg.source, destination: msg.destination, hash: replyHash, object: object, error: error, timestamp: Date.now()}; 
                    

                    this.streamSource.ingest(item);
                    
                } else {
                    ObjectDiscoveryAgent.log.debug('Error validating object discovery reply');
                }

            }

        }
    }

    shutdown(): void {

        // TODO: stop listening on linkup endpoints

        this.wasShutdown = true;
        this.streamSource.end();
    }



    private getNetworkAgent() {
        return this.pod?.getAgent(NetworkAgent.AgentId) as NetworkAgent;
    }


}

export { ObjectDiscoveryAgent, ObjectDiscoveryReply, ObjectDiscoveryReplyParams };