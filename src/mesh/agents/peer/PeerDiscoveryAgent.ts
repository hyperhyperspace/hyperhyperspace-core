import { Hash } from 'data/model';
import { AgentPod, Event } from 'mesh/service/AgentPod';
import { LinkupAddress, LinkupManager } from 'net/linkup';
import { Logger, LogLevel } from 'util/logging';
import { Shuffle } from 'util/shuffling';
import { Agent } from '../../service/Agent';
import { Endpoint, LinkupMessage, NetworkAgent, NetworkEventType } from '../network/NetworkAgent';
import { PeerBroadcastAgent, PeerBroadcastRequest, PeerBroadcastReply } from './PeerBroadcastAgent';
import { PeerInfo } from './PeerGroupAgent';
import { PeerSource } from './PeerSource';


type Params = {
    targetLinkupServers: string[];
    maxQueryFreq : number,
    maxPeers     : number,
    peerLifetime : number
};

type EndpointInfo = {
    hash: Hash,
    extra: any,
    timestamp: number
}

class PeerDiscoveryPeerSource implements PeerSource {

    agent: PeerDiscoveryAgent;

    constructor(agent: PeerDiscoveryAgent) {
        this.agent = agent; 
    }

    async getPeers(count: number): Promise<PeerInfo[]> {
        this.agent.queryForPeers();
        const peers = await this.agent.getPeers(count);

        PeerDiscoveryAgent.log.debug(() =>'Returning discovered endpoints at ' + this.agent.localEndpoint + ': ' + peers.map((pi: PeerInfo) => pi.endpoint));

        return peers;
    }

    async getPeerForEndpoint(endpoint: string): Promise<PeerInfo | undefined> {
        return this.agent.parseEndpoint(endpoint);
    }
    
}

class PeerDiscoveryAgent implements Agent {

    static log = new Logger(PeerDiscoveryAgent.name, LogLevel.INFO);

    static agentIdForHashPrefix(prefix: string) {
        return 'peer-discovery-for-' + prefix;
    }

    pod?: AgentPod;

    hashSuffix: string;
    localEndpoint: Endpoint;
    parseEndpoint : (ep: Endpoint) => Promise<PeerInfo | undefined>

    params: Params;


    lastQueryingTime?: number;
    currentPeers: Map<Endpoint, EndpointInfo>;

    peerSource: PeerSource;

    constructor(hashSuffix: string, localEndpoint: Endpoint, parseEndpoint : (ep: Endpoint) => Promise<PeerInfo | undefined>, params?: Partial<Params>) {
        this.hashSuffix = hashSuffix;
        this.localEndpoint = localEndpoint;
        this.parseEndpoint = parseEndpoint;
        
        if (params === undefined) {
            params = { };
        }

        this.params = {
            maxQueryFreq: params?.maxQueryFreq === undefined ? 30 : params?.maxQueryFreq,
            maxPeers: params?.maxPeers === undefined? 50 : params?.maxPeers,
            peerLifetime: params?.peerLifetime === undefined ? 30 : params?.peerLifetime,
            targetLinkupServers: params?.targetLinkupServers === undefined ? [LinkupManager.defaultLinkupServer] : params?.targetLinkupServers
        };

        this.currentPeers = new Map();

        this.peerSource = new PeerDiscoveryPeerSource(this);
    }

    getAgentId(): string {
        return PeerDiscoveryAgent.agentIdForHashPrefix(this.hashSuffix);
    }

    ready(pod: AgentPod): void {
        this.pod = pod;
        
        this.getNetworkAgent().listenForLinkupMessages(this.localEndpoint);
    }

    queryForPeers() {

        const currentTime = Date.now();

        const request: PeerBroadcastRequest = {
            agentId: this.getAgentId(),
            suffix: this.hashSuffix
        }

        if (this.lastQueryingTime === undefined ||
            currentTime > this.lastQueryingTime + this.params.maxQueryFreq * 1000) {
                
            this.lastQueryingTime = currentTime;

            for (const linkupServer of this.params.targetLinkupServers) {
                
                PeerDiscoveryAgent.log.trace(() => 
                    'Sending peer query from endpoint ' + 
                    this.localEndpoint + 
                    ' to endpoint ' + 
                    new LinkupAddress(linkupServer, PeerBroadcastAgent.linkupIdForHashSuffix(this.hashSuffix)).url() +
                    ' for suffix ' + this.hashSuffix);
                
                this.getNetworkAgent().sendLinkupMessage(
                    LinkupAddress.fromURL(this.localEndpoint),
                    new LinkupAddress(linkupServer, PeerBroadcastAgent.linkupIdForHashSuffix(this.hashSuffix)),
                    PeerBroadcastAgent.agentIdForHashSuffix(this.hashSuffix),
                    request
                )
            }

        } else {
            PeerDiscoveryAgent.log.trace(() => 'Querying for peers ignored, we queried too recently');
        }
    }

    getPeerSource() : PeerSource {
        return this.peerSource;
    }

    async getPeers(count: number) : Promise<PeerInfo[]>{


        let result : PeerInfo[] = [];

        //console.log('get peers at ' + this.localEndpoint + ' size: ' + this.currentPeers.size);

        const now = Date.now();

        for (const [endpoint, info] of this.currentPeers.entries()) {
            if (now <= info.timestamp + this.params.peerLifetime * 1000) {
                const pi = await this.parseEndpoint(endpoint);
                if (pi !== undefined) { 
                    result.push(pi); 
                }
            }
        }

        Shuffle.array(result);
        result = result.slice(0, count);

        return result;
    }

    receiveLocalEvent(ev: Event): void {
        if (ev.type === NetworkEventType.LinkupMessageReceived) {
            const msg = ev.content as LinkupMessage;

            const reply = msg.content as PeerBroadcastReply;

            if (this.hashSuffix === reply.hash.slice(-this.hashSuffix.length)) {
                PeerDiscoveryAgent.log.trace('Received peers ' + reply.peers + ' at ' + this.localEndpoint);

                if (this.currentPeers.size + reply.peers.length > this.params.maxPeers) {
                    //console.log('making room');
                    PeerDiscoveryAgent.log.trace('Attempting to make room for received peers');

                    let toRemove = [];
                    const now = Date.now();
                    for (const [endpoint, info] of this.currentPeers.entries()) {
                        if (now > info.timestamp + this.params.peerLifetime * 1000) {
                            toRemove.push(endpoint);
                        }
                    }

                    for (const endpoint of toRemove) {
                        this.currentPeers.delete(endpoint);
                    }
                }

                for (const endpoint of reply.peers) {
                    if (this.currentPeers.size < this.params.maxPeers) {
                        //console.log('found room, adding');
                        this.currentPeers.set(endpoint , {hash: reply.hash, extra: reply.extraInfo, timestamp: Date.now()});
                    }
                }

                //console.log('size in ' + this.localEndpoint + ' is ' + this.currentPeers.size);
            }
        }
    }

    shutdown(): void {
        
    }


    private getNetworkAgent() {
        return this.pod?.getAgent(NetworkAgent.AgentId) as NetworkAgent;
    }


}

export { PeerDiscoveryAgent };