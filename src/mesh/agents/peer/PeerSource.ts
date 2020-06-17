import { Endpoint } from '../network/NetworkAgent';
import { Peer } from './PeerMeshAgent';

interface PeerSource {

    getPeers(count: number): Promise<Array<Peer>>;
    getPeerForEndpoint(endpoint: Endpoint): Promise<Peer|undefined>;

}

export { PeerSource };