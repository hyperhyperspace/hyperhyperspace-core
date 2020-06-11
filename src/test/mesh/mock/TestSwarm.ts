import { ServicePod } from 'mesh/base/ServicePod';
import { Peer, SwarmControlAgent } from 'mesh/agents/swarm';
import { Identity, RSAKeyPair } from 'data/identity';
import { TestPeerSource } from './TestPeerSource';
import { RNGImpl } from 'crypto/random';
import { SecureConnectionAgent } from 'mesh/agents/security/SecureConnectionAgent';
import { NetworkAgent } from 'mesh/agents/network';



class TestSwarm {
    
    static generate(topic: string, activePeers: number, totalPeers: number, peerConnCount: number): Array<ServicePod> {

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
        let servicePods = new Array<ServicePod>();

        for (let i=0; i<activePeers; i++) {
            let servicePod = new ServicePod();
            let networkAgent = new NetworkAgent();
            servicePod.registerLocalAgent(networkAgent);
            let secureConn = new SecureConnectionAgent();
            servicePod.registerLocalAgent(secureConn);
            
            let peerControl = new SwarmControlAgent(topic, peers[i], peerSource, { maxPeers: peerConnCount, minPeers: peerConnCount });
            servicePod.registerLocalAgent(peerControl);
            servicePods.push(servicePod);
        }

        return servicePods;

    }

}

export { TestSwarm };