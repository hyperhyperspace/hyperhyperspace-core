import { PeerSource } from "./PeerSource";
import { Peer } from "./PeerGroupAgent";
import { Shuffle } from "util/shuffling";


class GenericPeerSource implements PeerSource {

    getAllPeers: () => Promise<Array<Peer>>;
    lookupPeer: (ep: string) => Promise<Peer | undefined>;
    
    constructor(getAllPeers: ()=>Promise<Array<Peer>>, lookupPeer: (ep: string) => Promise<Peer | undefined>) {
        this.getAllPeers = getAllPeers;
        this.lookupPeer = lookupPeer;
    }


    async getPeers(count: number): Promise<Peer[]> {
        let peers = await this.getAllPeers();
        Shuffle.array(peers);

        if (peers.length > count) {
            peers = peers.slice(0, count);
        }

        return peers;

    }
    async getPeerForEndpoint(endpoint: string): Promise<Peer | undefined> {
        return await this.lookupPeer(endpoint);
    }
    
}

export { GenericPeerSource };