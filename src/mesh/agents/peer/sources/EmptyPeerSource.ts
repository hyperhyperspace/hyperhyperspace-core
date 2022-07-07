import { PeerSource } from '../PeerSource';
import { PeerInfo } from '../PeerGroupAgent';
import { Endpoint } from 'mesh/agents/network';

class EmptyPeerSource implements PeerSource {

    endpointParser?: (e: Endpoint) => Promise<PeerInfo|undefined>;

    constructor(endpointParser?: (e: Endpoint) => Promise<PeerInfo|undefined>) {
        this.endpointParser = endpointParser;
    }

    async getPeers(count: number): Promise<Array<PeerInfo>> {
        count;
        return [];
    }

    async getPeerForEndpoint(endpoint: Endpoint): Promise<PeerInfo|undefined> {
        if (this.endpointParser === undefined) {
            return undefined;
        } else {
            return this.endpointParser(endpoint);
        }
        
    }

}

export { EmptyPeerSource };