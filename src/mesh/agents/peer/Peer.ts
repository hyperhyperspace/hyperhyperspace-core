
import { PeerInfo } from './PeerGroupAgent';
import { Endpoint } from '../network/NetworkAgent';

interface Peer {
    asPeer(): Promise<PeerInfo>;
    initFromEndpoint(ep: Endpoint): Promise<void>;
}

export { Peer }