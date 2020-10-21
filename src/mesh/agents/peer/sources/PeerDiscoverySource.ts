import { PeerInfo } from '../PeerGroupAgent';
import { PeerSource } from '../PeerSource';


class PeerDiscoverySource implements PeerSource {

    getPeers(count: number): Promise<PeerInfo[]> {
        throw new Error('Method not implemented.');
    }
    
    getPeerForEndpoint(endpoint: string): Promise<PeerInfo | undefined> {
        throw new Error('Method not implemented.');
    }

}