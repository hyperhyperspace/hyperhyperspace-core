import { PeerSource } from './PeerSource';
import { Peer } from './PeerMeshAgent';

class EmptyPeerSource implements PeerSource {
    async getPeers(count: number): Promise<Array<Peer>> {
        count;
        return [];
    }

    async getPeerForEndpoint(endpoint: string): Promise<Peer|undefined> {
        endpoint;
        return undefined;
    }

}

export { EmptyPeerSource };