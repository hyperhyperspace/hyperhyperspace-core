import { PeerSource, Peer } from 'mesh/agents/peer';
import { Shuffle } from 'util/shuffling';


class TestPeerSource implements PeerSource {

    peers: Peer[];

    constructor(peers: Peer[]) {
        this.peers = Array.from(peers);
    }

    async getPeers(count: number): Promise<Peer[]> {

        if (count > this.peers.length) {
            count = this.peers.length;
        }

        Shuffle.array(this.peers);
        
        return this.peers.slice(0, count).map((x:any) => { let y={} as any; Object.assign(y, x); return y;});
    }

    async getPeerForEndpoint(endpoint: string): Promise<Peer | undefined> {
        for (const peer of this.peers) {
            if (peer.endpoint === endpoint) {
                let x = {} as any;
                Object.assign(x, peer);
                return x;
            }
        }
        
        return undefined;
    }
    
}

export { TestPeerSource };