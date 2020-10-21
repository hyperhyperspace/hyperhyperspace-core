import { PeerSource } from '../PeerSource';
import { PeerInfo } from '../PeerGroupAgent';
import { Shuffle } from 'util/shuffling';

enum JoinMode {
    interleave = 'interleave',
    eager      = 'eager',
    random     = 'random'
};

class JoinPeerSources implements PeerSource {

    sources: PeerSource[];
    mode: JoinMode;

    constructor(sources: PeerSource[], mode: JoinMode = JoinMode.interleave) {
        this.sources = sources;
        this.mode    = mode;
    }

    async getPeers(count: number): Promise<PeerInfo[]> {
    
        let allPIs:PeerInfo[][] = [];
        let total = 0;

        let toFetch = count;

        for (const source of this.sources) {
            let pi = await source.getPeers(toFetch);
            allPIs.push(pi);
            total = total + pi.length;

            if (this.mode === JoinMode.eager) {
                toFetch = toFetch - pi.length;
                if (toFetch === 0) {
                    break;
                }
            }
        }
        
        let result: PeerInfo[] = [];

        if (this.mode === JoinMode.interleave) {
            while (total > 0 && result.length < count) {

                for (const pis of allPIs) {
                    if (pis.length > 0 && result.length < count) {
                        let pi = pis.pop() as PeerInfo;
                        total = total - 1;
                        result.push(pi);
                    }
                }
    
            }
        } else if (this.mode === JoinMode.random) {
            let all: PeerInfo[] = [];
            for (const pis of allPIs) {
                all = all.concat(pis);
            }

            Shuffle.array(all);
            result = all.slice(0, count);
        } else if (this.mode === JoinMode.eager) {
            for (const pis of allPIs) {
                result = result.concat(pis);
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