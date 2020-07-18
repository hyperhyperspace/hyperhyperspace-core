import { RNGImpl } from 'crypto/random';
import { PeerGroupAgent } from 'mesh/agents/peer';
import { TestPeerNetwork } from '../mock/TestPeerNetwork';
import { describeProxy } from 'config';
import { Logger, LogLevel } from 'util/logging';

describeProxy('Peer group management', () => {
    test('2-peer group set up', async (done) => {


        let peerNetworkId = new RNGImpl().randomHexString(64);
        let networks = TestPeerNetwork.generate(peerNetworkId, 2, 2, 1);
        networks;

        let control0 = networks[0].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;

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
    test('4-peer group clique set up', async (done) => {


        let peerNetworkId = new RNGImpl().randomHexString(64);
        let networks = TestPeerNetwork.generate(peerNetworkId, 4, 4, 3);
        networks;

        let control0 = networks[0].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;

        control0.controlLog = new Logger('mesh-debug', LogLevel.INFO);

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
    }, 35000);
});