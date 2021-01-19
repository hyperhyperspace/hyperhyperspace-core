
import { Hash, HashedObject } from 'data/model';
import { Store } from 'storage/store';
import { Mesh } from 'mesh/service';
import { Identity } from 'data/identity/Identity';
import { IdentityPeer, PeerInfo } from 'mesh/agents/peer';
import { Endpoint } from 'mesh/agents/network';
import { LinkupManager } from 'net/linkup';
import { MemoryBackend } from 'storage/backends';
import { RNGImpl } from 'crypto/random';
import { RSAKeyPair } from 'data/identity';


type Config = {
    linkupServers: Array<string>,
    id?: Identity,
    peersForDiscovery?: Array<PeerInfo>,
    endpointParserForDiscovery?: (ep: Endpoint) => Promise<PeerInfo>
};

type ResourceInit = { store: Store, mesh: Mesh, config: Partial<Config>, aliasing: Map<Hash, HashedObject> };


class Resources {

    store: Store; 
    mesh: Mesh;
    config: Config; 
    aliasing: Map<Hash, HashedObject>;

    constructor(init?: Partial<ResourceInit>) {

        const linkupServers = init?.config?.linkupServers !== undefined && init?.config.linkupServers.length > 0?
                        init.config.linkupServers :
                        [LinkupManager.defaultLinkupServer]; 

        this.config = {
            linkupServers: linkupServers
        }

        if (init?.store === undefined) {
            this.store = new Store(new MemoryBackend('auto-generated store ' + new RNGImpl().randomHexString(64)));
        } else {
            this.store = init?.store;
        }

        if (init?.mesh === undefined) {
            this.mesh = new Mesh();
        } else {
            this.mesh = init.mesh;
        }

        if (init?.config?.peersForDiscovery !== undefined &&
            init?.config?.endpointParserForDiscovery !== undefined) {

            this.config.peersForDiscovery = init.config.peersForDiscovery;
            this.config.endpointParserForDiscovery = init.config.endpointParserForDiscovery;

        } else {

            let localId: Identity;

            if (init?.config?.id !== undefined) {
                localId = init.config.id;
            } else {
                let key = RSAKeyPair.generate(1024);
                localId = Identity.fromKeyPair({name: 'auto-generated id ' + new RNGImpl().randomHexString(64)}, key);
                this.config.id = localId;
            }

            this.config.peersForDiscovery = [(new IdentityPeer(this.config.linkupServers[0], localId.hash(), localId)).asPeerIfReady()];
            this.config.endpointParserForDiscovery = IdentityPeer.getEndpointParser(this.store);
        }

        this.aliasing = new Map();

    }

    getId(): Identity {
        if (this.config.id === undefined) {
            throw new Error('A default identity was requested, but none was provided in the resources object.');
        }

        return this.config.id;
    }

    getPeersForDiscovery() {
        if (this.config.peersForDiscovery === undefined) {
            throw new Error('A list of peers for discovery was requested, but none was provided in the resources object.');
        }

        return this.config.peersForDiscovery;
    }

    getEndointParserForDiscovery() {
        if (this.config.endpointParserForDiscovery === undefined) {
            throw new Error('An endpoint parser for discovery was requested, but none was provided in the resources object.');
        }

        return this.config.endpointParserForDiscovery;


    }


}

export { Resources, ResourceInit, Config };