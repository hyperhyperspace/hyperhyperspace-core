import { PeerSource } from '../PeerSource';
import { Endpoint } from '../../network/NetworkAgent';
import { PeerInfo } from '../PeerGroupAgent';
import { Shuffle } from 'util/shuffling';


class ConstantPeerSource implements PeerSource {

    peers: Map<Endpoint, PeerInfo>;

    constructor(peers: IterableIterator<PeerInfo>) {
        this.peers = new Map(Array.from(peers).map((pi: PeerInfo) => [pi.endpoint, pi]));
    }

    async getPeers(count: number): Promise<PeerInfo[]> {
        let peers = Array.from(this.peers.values());
        Shuffle.array(peers);

        if (peers.length > count) {
            peers = peers.slice(0, count);
        }

        return peers;
    }

    async getPeerForEndpoint(endpoint: string): Promise<PeerInfo | undefined> {
        return this.peers.get(endpoint);
    }
    
}

export { ConstantPeerSource }