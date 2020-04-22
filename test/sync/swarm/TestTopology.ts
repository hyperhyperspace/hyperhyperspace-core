import { Swarm } from 'sync/swarm';
import { PeerId } from 'sync/swarm/Peer';
import { RNGImpl } from 'crypto/random';
import { TestPeerControlAgent } from '../agents/TestPeerControlAgent';
import { Shuffle } from 'util/shuffling';

class TestTopology {

    static ring(swarmCount: number) : Swarm[] {

        let swarms: Swarm[] = [];

        let peerIds:PeerId[] = []

        let rnd = new RNGImpl();

        let topic = rnd.randomHexString(16);

        for (let i=0; i<swarmCount; i++) {
            let peerId = rnd.randomHexString(48);
            peerIds.push(peerId);
        }

        for (let i=0; i<swarmCount; i++) {
            let peerControl = new TestPeerControlAgent(peerIds[i], [peerIds[(i+1)%swarmCount]]);
            let swarm = new Swarm(topic);
            swarm.registerLocalAgent(peerControl);
            swarms.push(swarm);
        }

        return swarms;

    }

    static clique(swarmCount: number) : Swarm[] {
        let swarms: Swarm[] = [];

        let peerIds:PeerId[] = []

        let rnd = new RNGImpl();

        let topic = rnd.randomHexString(16);

        for (let i=0; i<swarmCount; i++) {
            let peerId = rnd.randomHexString(48);
            peerIds.push(peerId);
        }

        for (let i=0; i<swarmCount; i++) {

            let swarmPeerIds = peerIds.slice();
            swarmPeerIds.splice(i, 1);

            let peerControl = new TestPeerControlAgent(peerIds[i], swarmPeerIds);
            let swarm = new Swarm(topic);
            swarm.registerLocalAgent(peerControl);
            swarms.push(swarm);
        }

        return swarms;
    }

    randomFixedDegree(swarmCount: number, degree: number) {
        let swarms: Swarm[] = [];

        let peerIds:PeerId[] = []

        let rnd = new RNGImpl();

        let topic = rnd.randomHexString(16);

        for (let i=0; i<swarmCount; i++) {
            let peerId = rnd.randomHexString(48);
            peerIds.push(peerId);
        }

        for (let i=0; i<swarmCount; i++) {

            let swarmPeerIds = peerIds.slice();
            swarmPeerIds.splice(i, 1);

            Shuffle.array(swarmPeerIds);
            
            swarmPeerIds.splice(degree, swarmPeerIds.length - degree);

            let peerControl = new TestPeerControlAgent(peerIds[i], swarmPeerIds);
            let swarm = new Swarm(topic);
            swarm.registerLocalAgent(peerControl);
            swarms.push(swarm);
        }

        return swarms;
    }

}

export { TestTopology }