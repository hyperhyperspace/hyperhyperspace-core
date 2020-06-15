import { RNGImpl } from 'crypto/random';
import { SwarmControlAgent } from 'mesh/agents/swarm';
import { TestSwarm } from '../mock/TestSwarm';


describe('Swarm management', () => {
    test('2-peer swarm set up', async (done) => {


        let swarmId = new RNGImpl().randomHexString(64);
        let networks = TestSwarm.generate(swarmId, 2, 2, 1);
        networks;

        let control0 = networks[0].getAgent(SwarmControlAgent.agentIdForSwarm(swarmId)) as SwarmControlAgent;

        let checks = 0;
        let stats = control0.getStats();
        while (stats.peers < 1 || stats.peers !== stats.connections) {
            await new Promise(r => setTimeout(r, 50));
            if (checks>400) {
                break;
            }
            checks++;
            stats = control0.getStats();
        }


        expect(control0.getPeers().length).toEqual(1);
        expect(stats.connections).toEqual(stats.peers);

        done();
    }, 25000);
    test('4-peer swarm clique set up', async (done) => {


        let swarmId = new RNGImpl().randomHexString(64);
        let networks = TestSwarm.generate(swarmId, 4, 4, 3);
        networks;

        let control0 = networks[0].getAgent(SwarmControlAgent.agentIdForSwarm(swarmId)) as SwarmControlAgent;

        let checks = 0;
        let stats = control0.getStats();
        while (stats.peers < 3 || stats.peers !== stats.connections) {
            await new Promise(r => setTimeout(r, 50));
            if (checks>400) {
                
                break;
            }
            checks++;
            stats = control0.getStats();
        }


        expect(control0.getPeers().length).toEqual(3);
        expect(stats.connections).toEqual(stats.peers);

        done();
    }, 25000);
});