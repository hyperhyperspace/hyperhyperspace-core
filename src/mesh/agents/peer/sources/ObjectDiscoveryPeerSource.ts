import { Hash, HashedObject } from 'data/model';
import { ObjectDiscoveryReply } from 'mesh/agents/discovery/ObjectDiscoveryAgent';
import { Endpoint } from 'mesh/agents/network/NetworkAgent';
import { Mesh } from 'mesh/service/Mesh';
import { AsyncStream } from 'util/streams';
import { PeerInfo } from '../PeerGroupAgent';
import { PeerSource } from '../PeerSource';


class ObjectDiscoveryPeerSource implements PeerSource {
    
    mesh: Mesh;
    object: HashedObject;
    parseEndpoint: (ep: Endpoint) => Promise<PeerInfo | undefined>;

    linkupServers: string[];
    replyEndpoint: Endpoint;
    timeoutMillis: number;
    
    hash: Hash;
    replyStream?: AsyncStream<ObjectDiscoveryReply>;

    constructor(mesh: Mesh, object: HashedObject, linkupServers: string[], replyEndpoint: Endpoint, parseEndpoint: (ep: Endpoint) => Promise<PeerInfo | undefined>, timeout=3) {
        this.mesh = mesh;
        this.object = object;
        this.parseEndpoint = parseEndpoint;

        this.linkupServers = linkupServers;
        this.replyEndpoint = replyEndpoint;
        this.timeoutMillis = timeout * 1000;

        this.hash = object.hash();
        
    }

    async getPeers(count: number): Promise<PeerInfo[]> {
        
        let found: PeerInfo[] = []
        let now = Date.now();
        let limit = now + this.timeoutMillis;

        if (this.replyStream === undefined) {
            this.replyStream = this.tryObjectDiscovery(count);;
        } else {
            const reply = this.replyStream.nextIfAvailable();

            while (reply !== undefined && found.length < count) {
                const peerInfo = await this.parseEndpoint(reply.source);
                if (peerInfo !== undefined) {
                    found.push(peerInfo);
                }  
            } 

            if (found.length < count) {
                this.retryObjectDiscovery(count);
            }
        }

        while (found.length < count && now < limit) {
            
            try {
                const reply = await this.replyStream.next(limit - now)
                const peerInfo = await this.parseEndpoint(reply.source);
                if (peerInfo !== undefined) {
                    found.push(peerInfo);
                }
            } catch(reason) {
                if (reason === 'timeout') {
                    break;
                } else if (reason === 'end') {
                    this.replyStream = this.tryObjectDiscovery(count - found.length);
                    break;
                } else {
                    // something odd happened TODO: log this
                    break;
                }
            }
        }

        return found;
    }

    getPeerForEndpoint(endpoint: string): Promise<PeerInfo | undefined> {
        return this.parseEndpoint(endpoint);
    }

    private tryObjectDiscovery(count: number) : AsyncStream<ObjectDiscoveryReply> {
        return this.mesh.findObjectByHash(this.hash, this.linkupServers, this.replyEndpoint, count);
    }

    private retryObjectDiscovery(count: number) {
        this.mesh.findObjectByHashRetry(this.hash, this.linkupServers, this.replyEndpoint, count);
    }
}

export { ObjectDiscoveryPeerSource };