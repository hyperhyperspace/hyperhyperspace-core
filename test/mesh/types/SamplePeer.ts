import { HashedObject, Hash } from 'data/model';
import { Identity } from 'data/identity';
import { PeerInfo } from 'mesh/agents/peer';
import { Endpoint } from 'mesh/agents/network';
import { LinkupManager } from 'net/linkup';

const LINKUP = LinkupManager.defaultLinkupServer + '/sample-peer-'

class SamplePeer extends HashedObject {

    static className = 'hhs-test/SamplePeer';
    static endpointForHash(hash: Hash) {
        return LINKUP + hash;
    }
    static hashForEndpoint(endpoint: Endpoint) {
        return endpoint.slice(LINKUP.length);
    }
    
    peerId?: Identity;

    constructor(peerId?: Identity) {
        super();
        this.peerId = peerId;
    }

    init() {

    }

    async validate() {
        return true;
    }

    getClassName() {
        return SamplePeer.className;
    }

    getPeer() : PeerInfo {
        if (this.peerId === undefined) {
            throw new Error('Cannot get peer from uninitialized SamplePeer object');
        }
        return { endpoint: SamplePeer.endpointForHash(this.hash()), identityHash: this.peerId?.hash(), identity: this.peerId};
    }

}

SamplePeer.registerClass(SamplePeer.className, SamplePeer);

export { SamplePeer };