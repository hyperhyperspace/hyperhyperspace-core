import { TestPeerSource } from './TestPeerSource';

import { AgentPod } from 'mesh/service';

import { PeerInfo, PeerGroupAgent } from 'mesh/agents/peer';
import { ObjectDiscoveryPeerSource } from 'mesh/agents/peer';

import { PeerSource } from 'mesh/agents/peer';

import { RNGImpl } from 'crypto/random';
import { Identity, RSAKeyPair } from 'data/identity';
import { LinkupManager } from 'net/linkup';
import { HashedLiteral } from 'data/model';
import { Mesh } from 'mesh/service';


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
            let mesh = new Mesh();
            let pod = mesh.pod;

            let peerSourceToUse: PeerSource = peerSource;

            let params: any = { maxPeers: peerConnCount, minPeers: peerConnCount, tickInterval: 1.5, peerConnectionAttemptInterval: 15, peerConnectionTimeout: 14 };

            if (discovery === 'linkup-discovery') {

                params.tickInterval = 1; // speed up peer group management to make up for peer discovery

                let object = new HashedLiteral(peerGroupId);


                mesh.startObjectBroadcast(object, [LinkupManager.defaultLinkupServer], [peers[i].endpoint]);

                peerSourceToUse = new ObjectDiscoveryPeerSource(mesh, object, [LinkupManager.defaultLinkupServer], peers[i].endpoint, (ep: string) => peerSource.getPeerForEndpoint(ep));
            }

            let peerGroupAgent = new PeerGroupAgent(peerGroupId, peers[i], peerSourceToUse, params);
            pod.registerAgent(peerGroupAgent);
            pods.push(pod);
        }

        return pods;

    }

}

export { TestPeerGroupPods };