import { Endpoint } from '../../network';
import { Peer } from './PeerControlAgent';

interface PeerSource {

    getPeers(count: number): Promise<Array<Peer>>;
    getPeerForEndpoint(endpoint: Endpoint): Promise<Peer|undefined>;

}

export { PeerSource };