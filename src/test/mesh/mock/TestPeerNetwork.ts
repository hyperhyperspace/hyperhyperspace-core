import { AgentPod } from 'mesh/base/AgentPod';
import { Peer, PeerMeshAgent } from 'mesh/agents/peer';
import { Identity, RSAKeyPair } from 'data/identity';
import { TestPeerSource } from './TestPeerSource';
import { RNGImpl } from 'crypto/random';
import { SecureNetworkAgent } from 'mesh/agents/network/SecureNetworkAgent';
import { NetworkAgent } from 'mesh/agents/network';



class TestPeerNetwork {
    
    static generate(topic: string, activePeers: number, totalPeers: number, peerConnCount: number): Array<AgentPod> {

        let peers = new Array<Peer>();

        for (let i=0; i<totalPeers; i++) {
            let id = Identity.fromKeyPair({'id':'peer' + i}, RSAKeyPair.generate(512));
            
            let peer: Peer = {
                endpoint: 'ws://localhost:3002/' + new RNGImpl().randomHexString(128),
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
            
            let peerNetwork = new PeerMeshAgent(topic, peers[i], peerSource, { maxPeers: peerConnCount, minPeers: peerConnCount });
            pod.registerAgent(peerNetwork);
            pods.push(pod);
        }

        return pods;

    }

}

export { TestPeerNetwork as TestPeerNetwork };