import { PeerSource } from '../PeerSource';
import { PeerInfo } from '../PeerGroupAgent';


class JoinPeerSources implements PeerSource {

    sources: PeerSource[];

    constructor(sources: PeerSource[]) {
        this.sources = sources;
    }

    async getPeers(count: number): Promise<PeerInfo[]> {
    
        let allPIs:PeerInfo[][] = [];
        let total = 0;

        for (const source of this.sources) {
            let pi = await source.getPeers(count);
            allPIs.push(pi);
            total = total + pi.length;
        }
        
        let result: PeerInfo[] = [];

        while (total > 0 && result.length < count) {

            for (const pis of allPIs) {
                if (pis.length > 0 && result.length < count) {
                    let pi = pis.pop() as PeerInfo;
                    total = total - 1;
                    result.push(pi);
                }
            }

        }

        return result;
    }

    async getPeerForEndpoint(endpoint: string): Promise<PeerInfo | undefined> {
        
        for (const source of this.sources) {
            let pi = await source.getPeerForEndpoint(endpoint);

            if (pi !== undefined) {
                return pi;
            }
        }

        return undefined;
    }
    
}

export { JoinPeerSources };