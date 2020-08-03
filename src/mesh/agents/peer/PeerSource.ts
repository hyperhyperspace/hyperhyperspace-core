import { Endpoint } from '../network/NetworkAgent';
import { PeerInfo } from './PeerGroupAgent';

interface PeerSource {

    getPeers(count: number): Promise<Array<PeerInfo>>;
    getPeerForEndpoint(endpoint: Endpoint): Promise<PeerInfo|undefined>;

}

export { PeerSource };