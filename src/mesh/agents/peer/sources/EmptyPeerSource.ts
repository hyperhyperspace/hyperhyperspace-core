import { PeerSource } from '../PeerSource';
import { PeerInfo } from '../PeerGroupAgent';

class EmptyPeerSource implements PeerSource {
    async getPeers(count: number): Promise<Array<PeerInfo>> {
        count;
        return [];
    }

    async getPeerForEndpoint(endpoint: string): Promise<PeerInfo|undefined> {
        endpoint;
        return undefined;
    }

}

export { EmptyPeerSource };