import { Hash, HashedObject, Hashing } from 'data/model';
import { AgentPod, Event } from 'mesh/service/AgentPod';
import { LinkupAddress } from 'net/linkup';
import { Logger, LogLevel } from 'util/logging';
import { Agent } from '../../service/Agent';
import { Endpoint, LinkupMessage, NetworkAgent, NetworkEventType } from '../network/NetworkAgent';
import { ObjectBroadcastAgent, ObjectBroadcastRequest, ObjectBroadcastReply } from './ObjectBroadcastAgent';

import { AsyncStream, BufferedAsyncStream, AsyncStreamSource, FilteredAsyncStreamSource } from 'util/streams';

type Params = {
    broadcastedSuffixBits : number,
    maxQueryFreq          : number,
    maxStoredReplies      : number
};

type ObjectDiscoveryReply = { source: Endpoint, destination: Endpoint, hash: Hash, object: HashedObject, timestamp: number };

type ObjectDiscoveryReplyParams = {maxAge?: number, linkupServers?: string[], localEndpoints?: Endpoint[]};

class ObjectDiscoveryAgent implements Agent, AsyncStreamSource<ObjectDiscoveryReply> {

    static log = new Logger(ObjectDiscoveryAgent.name, LogLevel.INFO);

    static agentIdForHexHashSuffix(suffix: string) {
        return 'object-discovery-for-' + suffix;
    }

    static newestReplyFirst = (a: ObjectDiscoveryReply, b: ObjectDiscoveryReply) => (b.timestamp - a.timestamp);

    pod?: AgentPod;

    
    hexHashSuffix: string;
    params: Params;

    localEndpoints: Set<Endpoint>;
    replies: ObjectDiscoveryReply[];
    lastQueryingTimePerServer: Map<string, number>;

    itemSubscriptions: Set<(elem: ObjectDiscoveryReply) => void>;
    endSubscriptions: Set<() => void>;

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
        this.replies = [];
        this.lastQueryingTimePerServer = new Map();

        this.itemSubscriptions = new Set();
        this.endSubscriptions = new Set();
    }

    getAgentId(): string {
        return ObjectDiscoveryAgent.agentIdForHexHashSuffix(this.hexHashSuffix);
    }

    ready(pod: AgentPod): void {
        this.pod = pod;
    }

    query(linkupServers: string[], localEndpoint: Endpoint, count=1) {

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

        if (!this.localEndpoints.has(localEndpoint)) {
            this.getNetworkAgent().listenForLinkupMessages(localEndpoint);
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

        let source: AsyncStreamSource<ObjectDiscoveryReply> = this; 

        const maxAge         = filterParams?.maxAge;
        const linkupServers  = filterParams?.linkupServers;
        const localEndpoints = filterParams?.localEndpoints;

        if (maxAge !== undefined ||
            linkupServers !== undefined ||
            localEndpoints !== undefined) {

            let filter = (elem: ObjectDiscoveryReply) => {

                let now = Date.now();
                let accept = true;
                
                accept = accept && (maxAge === undefined || elem.timestamp >= now - maxAge * 1000);
                accept = accept && (linkupServers === undefined || linkupServers.indexOf(LinkupAddress.fromURL(elem.source).serverURL) >= 0);
                accept = accept && (localEndpoints === undefined || localEndpoints.indexOf(elem.destination) >= 0);
                
                return accept;
            }
            
            source = new FilteredAsyncStreamSource<ObjectDiscoveryReply>(source, filter);
        }

        return new BufferedAsyncStream(this);;
    }

    receiveLocalEvent(ev: Event): void {

        if (! this.wasShutdown && ev.type === NetworkEventType.LinkupMessageReceived) {
            const msg = ev.content as LinkupMessage;

            if (msg.agentId === this.getAgentId()) {

                const reply = msg.content as ObjectBroadcastReply;

                

                let replyHash: Hash = '';
                let object: HashedObject | undefined = undefined;
                try {
                    object = HashedObject.fromLiteralContext(reply.literalContext);
                    replyHash = object.hash();
                } catch (e) {
                    ObjectDiscoveryAgent.log.warning('Error deliteralizing object discovery reply:' + e);
                    object = undefined;
                }

                if (object !== undefined && replyHash === reply.literalContext.rootHashes[0] && 
                    this.hexHashSuffix === Hashing.toHex(replyHash).slice(-this.hexHashSuffix.length) &&
                    this.localEndpoints.has(msg.destination)) {

                    ObjectDiscoveryAgent.log.trace(() => 'Received object with hash ' + replyHash + ' from ' + msg.source + ' at ' + msg.destination);

                    let item = {source: msg.source, destination: msg.destination, hash: replyHash, object: object, timestamp: Date.now()}; 

                    if (this.replies.length === this.params.maxStoredReplies) {
                        this.replies.shift();
                    }

                    this.replies.push(item);

                    ObjectDiscoveryAgent.log.trace(() => 'About to fire ' + this.itemSubscriptions.size + ' callbacks.');


                    for (const itemCallback of this.itemSubscriptions) {
                        itemCallback(item);
                    }
                    
                } else {
                    ObjectDiscoveryAgent.log.debug('Error validating object discovery reply');
                }

            }

        }
    }

    shutdown(): void {

        // TODO: stop listening on linkup endpoints

        this.wasShutdown = true;
        for (const endCallback of this.endSubscriptions) {
            endCallback();
        }
    }

    current(): ObjectDiscoveryReply[] {
        return this.replies.slice();
    }

    subscribeNewItem(cb: (elem: ObjectDiscoveryReply) => void): void {
        this.itemSubscriptions.add(cb);
    }
    
    subscribeEnd(cb: () => void): void {
        this.endSubscriptions.add(cb);
    }
    
    unsubscribeNewItem(cb: (elem: ObjectDiscoveryReply) => void): void {
        this.itemSubscriptions.delete(cb);
    }
    
    unsubscribeEnd(cb: () => void): void {
        this.endSubscriptions.delete(cb);
    }


    private getNetworkAgent() {
        return this.pod?.getAgent(NetworkAgent.AgentId) as NetworkAgent;
    }


}

export { ObjectDiscoveryAgent, ObjectDiscoveryReply, ObjectDiscoveryReplyParams };