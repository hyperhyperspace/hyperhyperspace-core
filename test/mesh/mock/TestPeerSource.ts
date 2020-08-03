import { PeerSource, PeerInfo } from 'mesh/agents/peer';
import { Shuffle } from 'util/shuffling';


class TestPeerSource implements PeerSource {

    peers: PeerInfo[];

    constructor(peers: PeerInfo[]) {
        this.peers = Array.from(peers);
    }

    async getPeers(count: number): Promise<PeerInfo[]> {

        if (count > this.peers.length) {
            count = this.peers.length;
        }

        Shuffle.array(this.peers);
        
        return this.peers.slice(0, count).map((x:any) => { let y={} as any; Object.assign(y, x); return y;});
    }

    async getPeerForEndpoint(endpoint: string): Promise<PeerInfo | undefined> {
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