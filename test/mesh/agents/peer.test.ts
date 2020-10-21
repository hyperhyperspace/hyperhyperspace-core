import { RNGImpl } from 'crypto/random';
import { PeerGroupAgent } from 'mesh/agents/peer';
import { TestPeerGroupPods } from '../mock/TestPeerGroupPods';
import { describeProxy } from 'config';
import { Logger, LogLevel } from 'util/logging';

describeProxy('Peer group management', () => {
    test('2-peer group set up (wrtc)', async (done) => {

        await twoPeerGroupTest(done, 'wrtc', 'no-discovery');
        
    }, 25000);

    test('2-peer group set up (ws)', async (done) => {

        await twoPeerGroupTest(done, 'ws', 'no-discovery', 5000);

    }, 25000);

    test('2-peer group set up (mix)', async (done) => {

        await twoPeerGroupTest(done, 'mix', 'no-discovery', 5010);

    }, 25000);

    test('2-peer group set up (wrtc) with peer discovery', async (done) => {

        await twoPeerGroupTest(done, 'wrtc', 'linkup-discovery');

    }, 25000);

    test('4-peer group clique set up (wrtc)', async (done) => {

        await fourPeerCliqueGroupTest(done, 'wrtc', 'no-discovery');

    }, 35000);

    test('4-peer group clique set up (ws)', async (done) => {

        await fourPeerCliqueGroupTest(done, 'ws', 'no-discovery', 5100);

    }, 35000);

    test('4-peer group clique set up (mix)', async (done) => {

        await fourPeerCliqueGroupTest(done, 'mix', 'no-discovery', 5110);

    }, 35000);

    test('4-peer group clique set up (wrtc) with peer discovery', async (done) => {

        await fourPeerCliqueGroupTest(done, 'wrtc', 'linkup-discovery');

    }, 35000);
});

async function twoPeerGroupTest(done: (() => void), network: 'wrtc'|'ws'|'mix' = 'wrtc', discovery:'linkup-discovery'|'no-discovery', basePort?: number) {

    let peerGroupId = new RNGImpl().randomHexString(64);
    let pods = TestPeerGroupPods.generate(peerGroupId, 2, 2, 1, network, discovery, basePort);
    pods;



    let control0 = pods[0].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerGroupId)) as PeerGroupAgent;

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
}

async function fourPeerCliqueGroupTest(done: () => void, network: 'wrtc'|'ws'|'mix' = 'wrtc', discovery:'linkup-discovery'|'no-discovery', basePort?: number) {

    let peerNetworkId = new RNGImpl().randomHexString(64);
    let networks = TestPeerGroupPods.generate(peerNetworkId, 4, 4, 3, network, discovery, basePort);
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
}