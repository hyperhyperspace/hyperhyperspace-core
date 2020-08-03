import { PeerSource } from './PeerSource';
import { PeerInfo } from './PeerGroupAgent';
import { Shuffle } from 'util/shuffling';
import { MutableSet } from 'data/containers';
import { HashedObject, HashedSet, Hash } from 'data/model';
import { Endpoint } from '../network/NetworkAgent';
import { Peer } from './Peer';

type HashBasedPeerContainer<T extends HashedObject & Peer> = { items: (IterableIterator<T> | Map<Hash, T> | MutableSet<T> | HashedSet<T>), parseEndpoint:(ep: Endpoint) => Hash | undefined};


/* Internal representation: the iterables are indexed by their hashes,      */
/*                          the rest are used as-is, supporting mutability. */

type HashedPeers<T extends HashedObject & Peer> = { items: Map<Hash, T> | MutableSet<T> | HashedSet<T>, parseEndpoint: (ep: Endpoint) => Hash | undefined};

class HashBasedPeerSource<T extends HashedObject & Peer> implements PeerSource {

    sources: HashedPeers<T>[];
    
    constructor(sources: HashBasedPeerContainer<T>[]) {

        if (sources === undefined) {
            sources = [];
        }

        this.sources = sources.map(HashBasedPeerSource.toHashedPeerContainer);
    }

    addSource(source: HashBasedPeerContainer<T>) {
        this.sources.push(HashBasedPeerSource.toHashedPeerContainer(source));
    }


    async getPeers(count: number): Promise<PeerInfo[]> {
        let peers =this.getPeersFromAllSources();
        Shuffle.array(peers);

        if (peers.length > count) {
            peers = peers.slice(0, count);
        }

        return peers;


    }

    async getPeerForEndpoint(endpoint: Endpoint): Promise<PeerInfo | undefined> {

        for (const source of this.sources) {
            let peerInfo = HashBasedPeerSource.lookupEndpointInSource(endpoint, source);

            if (peerInfo !== undefined) {
                return peerInfo;
            }
        }

        return undefined;
    }

    private static lookupEndpointInSource<T extends HashedObject & Peer>(ep: Endpoint, source: HashedPeers<T>) : PeerInfo | undefined {
        
        let hash = source.parseEndpoint(ep);
        let found: T|undefined = undefined;

        if (hash !== undefined) {
            if (source.items instanceof Map) {
                found = source.items.get(hash);
            } else if (source.items instanceof MutableSet ||
                       source.items instanceof HashedSet) {
                found = source.items.get(hash);
            } else {
                throw new Error('Unexpected type for peer source.items: ' + (typeof source.items));
            }
        }

        return found === undefined? found : found.asPeer();
    }

    private getPeersFromSource(source: HashedPeers<T>) : Array<PeerInfo>{
        
        let ts: Array<T>;

        if (source.items instanceof Map) {
            ts = Array.from(source.items.values());
        } else if (source instanceof MutableSet || 
                   source instanceof HashedSet) {
            ts = Array.from(source.values());
        } else {
            throw new Error('Unexpected type for peer source: ' + (typeof source));
        }

        return ts.map((t:T) => t.asPeer());
    }

    private getPeersFromAllSources() : Array<PeerInfo> {
        let result: Array<PeerInfo> = [];

        for (const source of this.sources) {
            result = result.concat(this.getPeersFromSource(source));
        }

        return result;
    }

    private static toHashedPeerContainer<T extends HashedObject & Peer>(c: HashBasedPeerContainer<T>) : HashedPeers<T> {

        let items = c.items instanceof HashedSet || c.items instanceof MutableSet || c.items instanceof Map?
            c.items : new Map<Hash, T>(Array.from(c.items).map((t:T) => [t.hash(), t]));

        return {items: items, parseEndpoint: c.parseEndpoint};

    }

}

export { HashBasedPeerSource, HashBasedPeerContainer };