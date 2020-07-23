import { PeerSource } from "./PeerSource";
import { Peer } from './PeerGroupAgent';
import { Shuffle } from 'util/shuffling';
import { MutableSet } from 'data/containers';
import { HashedObject, HashedSet, Hash } from 'data/model';
import { Endpoint } from '../network/NetworkAgent';


type Container<T extends HashedObject> = Map<Hash, T> | MutableSet<T> | HashedSet<T>;

class GenericPeerSource<T extends HashedObject> implements PeerSource {

    sources: Array<Container<T>>;
    makePeer: (t: T) => Peer | undefined;
    hashForEndpoint: ((ep: Endpoint) => Hash | undefined);
    newPeerForEndpoint?: ((ep: Endpoint) => Peer | undefined);
    
    constructor(makePeer: (t:T) => Peer | undefined, hashForEndpoint: ((ep: Endpoint) => Hash | undefined), sources: Array<Container<T>>=[], newPeerForEndpoint?: ((ep: Endpoint) => Peer | undefined) ) {
        
        if (sources === undefined) {
            sources = [];
        }

        this.sources = sources;
        this.makePeer = makePeer;
        this.hashForEndpoint = hashForEndpoint;
        this.newPeerForEndpoint = newPeerForEndpoint;

    }

    addSource(source: Container<T>) {
        this.sources.push(source);
    }


    async getPeers(count: number): Promise<Peer[]> {
        let peers =this.getPeersFromAllSources();
        Shuffle.array(peers);

        if (peers.length > count) {
            peers = peers.slice(0, count);
        }

        return peers;


    }
    async getPeerForEndpoint(endpoint: Endpoint): Promise<Peer | undefined> {
        let hash = this.hashForEndpoint(endpoint);
        let peer: Peer|undefined = undefined;

        if (hash !== undefined) {
            peer = this.lookupHashInAllSources(hash);
        }

        if (peer === undefined && this.newPeerForEndpoint !== undefined) {
            peer = this.newPeerForEndpoint(endpoint);
        }

        return peer;
    }

    private lookupHashInSource(hash: Hash, source: Container<T>) : Peer | undefined {
        let found: T|undefined;

        if (source instanceof Map) {
            found = source.get(hash);
        } else if (source instanceof MutableSet ||
                   source instanceof HashedSet) {
            found = source.get(hash);
        } else {
            throw new Error('Unexpected type for peer source: ' + (typeof source));
        }

        return found === undefined? found : this.makePeer(found);
    }

    private lookupHashInAllSources(hash: Hash) : Peer | undefined {
        let found: Peer|undefined;

        for (const source of this.sources) {
            let found = this.lookupHashInSource(hash, source);
            if (found !== undefined) {
                break;
            }
        }

        return found;
    }

    private getPeersFromSource(source: Container<T>) : Array<Peer>{
        
        let ts: Array<T>;

        if (source instanceof Map) {
            ts = Array.from(source.values());
        } else if (source instanceof MutableSet || 
                   source instanceof HashedSet) {
            ts = Array.from(source.values());
        } else {
            throw new Error('Unexpected type for peer source: ' + (typeof source));
        }

        let notUndef = (p:Peer|undefined) => p !== undefined;

        return ts.map(this.makePeer).filter(notUndef) as Array<Peer>;
    }

    private getPeersFromAllSources() : Array<Peer> {
        let result: Array<Peer> = [];

        for (const source of this.sources) {
            result = result.concat(this.getPeersFromSource(source));
        }

        return result;
    }

}

export { GenericPeerSource };