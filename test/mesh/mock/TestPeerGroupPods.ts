import { TestPeerSource } from './TestPeerSource';

import { AgentPod } from 'mesh/service';

import { NetworkAgent, SecureNetworkAgent } from 'mesh/agents/network';
import { PeerInfo, PeerGroupAgent } from 'mesh/agents/peer';
import { PeerBroadcastAgent, PeerDiscoveryAgent } from 'mesh/agents/peer';

import { PeerSource } from 'mesh/agents/peer';

import { RNGImpl } from 'crypto/random';
import { Identity, RSAKeyPair } from 'data/identity';
import { LinkupManager } from 'net/linkup';






class TestPeerGroupPods {
    
    static generate(peerGroupId: string, activePeers: number, totalPeers: number, peerConnCount: number, network: 'wrtc'|'ws'|'mix' = 'wrtc', discovery:'linkup-discovery'|'no-discovery', basePort?: number): Array<AgentPod> {

        let peers = new Array<PeerInfo>();

        for (let i=0; i<totalPeers; i++) {
            let id = Identity.fromKeyPair({'id':'peer' + i}, RSAKeyPair.generate(512));
            
            let host = LinkupManager.defaultLinkupServer;

            if (network === 'ws' || (network === 'mix' && i < totalPeers / 2)) {
                host = 'ws://localhost:' + (basePort as number + i);
            }

            let peer: PeerInfo = {
                endpoint: host  + '/' + new RNGImpl().randomHexString(128),
                identity: id,
                identityHash: id.hash()
            };

            peers.push(peer);
        }

        let peerSource = new TestPeerSource(peers);
        let pods = new Array<AgentPod>();

        for (let i=0; i<activePeers; i++) {
            let pod = new AgentPod();
            let networkAgent = new NetworkAgent();
            pod.registerAgent(networkAgent);
            let secureConn = new SecureNetworkAgent();
            pod.registerAgent(secureConn);

            let peerSourceToUse: PeerSource = peerSource;

            let params: any = { maxPeers: peerConnCount, minPeers: peerConnCount, tickInterval: 1.5, peerConnectionAttemptInterval: 1.5 };

            if (discovery === 'linkup-discovery') {

                params.tickInterval = 1; // speed up peer group management to make up for peer discovery

                let broadcastAgent = new PeerBroadcastAgent(peerGroupId,
                    [peers[i].endpoint]
                );
                pod.registerAgent(broadcastAgent);
                const suffix = PeerBroadcastAgent.getSuffix(peerGroupId);
                let discoveryAgent = new PeerDiscoveryAgent(
                    suffix, 
                    peers[i].endpoint,
                    (ep: string) => peerSource.getPeerForEndpoint(ep),
                    {maxQueryFreq: 1}
                );
                pod.registerAgent(discoveryAgent);
                peerSourceToUse = discoveryAgent.getPeerSource();
            }

            let peerGroupAgent = new PeerGroupAgent(peerGroupId, peers[i], peerSourceToUse, params);
            pod.registerAgent(peerGroupAgent);
            pods.push(pod);
        }

        return pods;

    }

}

export { TestPeerGroupPods };