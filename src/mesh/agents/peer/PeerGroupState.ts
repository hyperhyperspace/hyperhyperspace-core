import { Endpoint } from '../network';
import { PeerInfo } from './PeerGroupAgent';


type PeerGroupState = {
    local: PeerInfo,
    remote: Map<Endpoint, PeerInfo>
};

export type { PeerGroupState  };