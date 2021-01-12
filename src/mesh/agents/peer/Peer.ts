
import { PeerInfo } from './PeerGroupAgent';
import { Endpoint } from '../network/NetworkAgent';

interface Peer {
    asPeer(): Promise<PeerInfo>;
    asPeerIfReady(): PeerInfo | undefined;
    initFromEndpoint(ep: Endpoint): Promise<void>;
}

export { Peer }