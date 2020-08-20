import { Resources } from 'data/model';

import { PeerSource } from '../agents/peer/PeerSource';
import { PeerInfo } from '../agents/peer/PeerGroupAgent';
import { PeerGroupInfo } from './Mesh';



abstract class PeerGroup {

    abstract getResources(): Resources;

    abstract getPeerGroupId(): string;
    abstract getLocalPeer(): Promise<PeerInfo>;
    abstract getPeerSource(): Promise<PeerSource>;

    async getPeerGroupInfo(): Promise<PeerGroupInfo> {
        return {
            id         : this.getPeerGroupId(),
            localPeer  : await this.getLocalPeer(),
            peerSource : await this.getPeerSource()
        };
    }
}

export { PeerGroup };