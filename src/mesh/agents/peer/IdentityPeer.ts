import { Hash, Hashing, HashReference } from 'data/model';
import { Identity } from 'data/identity';
import { LinkupAddress, LinkupManager } from 'net/linkup';
import { Peer } from './Peer';
import { PeerInfo } from './PeerGroupAgent';
import { Store } from 'storage/store';
import { Endpoint } from '../network/NetworkAgent';


class IdentityPeer implements Peer {

    static fromIdentity(id: Identity, linkupServer = LinkupManager.defaultLinkupServer) : IdentityPeer {
        let ip = new IdentityPeer(linkupServer, id.hash(), id);

        return ip;
    }

    linkupServer?: string;
    identityHash?: Hash;
    identity?: Identity;

    constructor(linkupServer?: string, identityHash?: Hash, identity?: Identity) {
        this.linkupServer = linkupServer;
        this.identityHash = identityHash;
        this.identity = identity;
    }

    async asPeer(): Promise<PeerInfo> {

        if (this.linkupServer === undefined || this.identityHash === undefined) {
            throw new Error('Missing peer information.');
        }

        return { endpoint: new LinkupAddress(this.linkupServer, Hashing.toHex(this.identityHash)).url(), identityHash: this.identityHash, identity: this.identity }
    }

    async initFromEndpoint(ep: string, store?: Store): Promise<void> {
        const address = LinkupAddress.fromURL(ep);
        this.linkupServer = address.serverURL;
        this.identityHash = Hashing.fromHex(address.linkupId);

        if (store !== undefined) {
            this.identity = await store.loadRef<Identity>(new HashReference(this.identityHash, Identity.className));
        }
    }
    
    static getEndpointParser(store?: Store) : (ep: Endpoint) => Promise<PeerInfo>{
        return async (ep: Endpoint) => {
            const ip = new IdentityPeer();
            await ip.initFromEndpoint(ep, store);
            return ip.asPeer();
        }
    }    
}

export { IdentityPeer };