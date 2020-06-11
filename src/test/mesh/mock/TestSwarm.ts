import { Network } from 'mesh/base/Service';
import { Peer, SwarmControlAgent } from 'mesh/agents/swarm';
import { Identity, RSAKeyPair } from 'data/identity';
import { TestPeerSource } from './TestPeerSource';
import { RNGImpl } from 'crypto/random';
import { SecureConnectionAgent } from 'mesh/agents/security/SecureConnectionAgent';
import { NetworkAgent } from 'mesh/agents/network';



class TestSwarm {
    
    static generate(topic: string, activePeers: number, totalPeers: number, peerConnCount: number): Array<Network> {

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
        let networks = new Array<Network>();

        for (let i=0; i<activePeers; i++) {
            let network = new Network();
            let networkAgent = new NetworkAgent();
            network.registerLocalAgent(networkAgent);
            let secureConn = new SecureConnectionAgent();
            network.registerLocalAgent(secureConn);
            
            let peerControl = new SwarmControlAgent(topic, peers[i], peerSource, { maxPeers: peerConnCount, minPeers: peerConnCount });
            network.registerLocalAgent(peerControl);
            networks.push(network);
        }

        return networks;

    }

}

export { TestSwarm };