import { Hash, Hashing, HashReference } from 'data/model';
import { Identity } from 'data/identity';
import { LinkupAddress, LinkupManager } from 'net/linkup';
import { Peer } from './Peer';
import { PeerInfo } from './PeerGroupAgent';
import { Store } from 'storage/store';
import { Endpoint } from '../network/NetworkAgent';


class IdentityPeer implements Peer {

    static fromIdentity(id: Identity, linkupServer = LinkupManager.defaultLinkupServer, info: string) : IdentityPeer {
        let ip = new IdentityPeer(linkupServer, id.hash(), id, info);

        return ip;
    }

    linkupServer?: string;
    identityHash?: Hash;
    identity?: Identity;
    info?: string;

    constructor(linkupServer?: string, identityHash?: Hash, identity?: Identity, info?: string) {
        this.linkupServer = linkupServer;
        this.identityHash = identityHash;
        this.identity = identity;
        this.info = info;
    }

    // in this case, there's nothing async to wait for.
    
    async asPeer(): Promise<PeerInfo> {
        return this.asPeerIfReady();
    }

    asPeerIfReady(): PeerInfo {
        if (this.linkupServer === undefined || this.identityHash === undefined) {
            throw new Error('Missing peer information.');
        }

        let linkupId = Hashing.toHex(this.identityHash);
        if (this.info !== undefined) {
            linkupId = linkupId + '/' + this.info;
        }

        return { endpoint: new LinkupAddress(this.linkupServer, linkupId).url(), identityHash: this.identityHash, identity: this.identity }
    }

    async initFromEndpoint(ep: string, store?: Store): Promise<void> {
        const address = LinkupAddress.fromURL(ep);
        this.linkupServer = address.serverURL;
        const parts = address.linkupId.split('/');
        this.identityHash = Hashing.fromHex(parts.shift() as string);
        this.info = parts.length > 0? parts.join('/') : undefined;

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