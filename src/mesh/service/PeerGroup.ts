import { Resources } from 'data/model';

import { PeerSource } from '../agents/peer/PeerSource';
import { PeerInfo } from '../agents/peer/PeerGroupAgent';
import { PeerGroupInfo } from './Mesh';



abstract class PeerGroup {

    resources?: Resources;

    getResources(): Resources | undefined {
        return this.resources;
    }

    abstract getPeerGroupId(): string;
    abstract getLocalPeer(): Promise<PeerInfo>;
    abstract getPeerSource(): Promise<PeerSource>;

    async init(resources?: Resources): Promise<void> {
        this.resources = resources;
    }

    async getPeerGroupInfo(): Promise<PeerGroupInfo> {
        return {
            id         : this.getPeerGroupId(),
            localPeer  : await this.getLocalPeer(),
            peerSource : await this.getPeerSource()
        };
    }
}

export { PeerGroup };