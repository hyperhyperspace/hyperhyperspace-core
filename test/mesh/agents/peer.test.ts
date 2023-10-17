import { RNGImpl } from 'crypto/random';
import { PeerGroupAgent } from 'mesh/agents/peer';
import { TestPeerGroupPods } from '../mock/TestPeerGroupPods';
import { describeProxy } from 'config';
import { WebRTCConnection } from 'index';
//import { Logger, LogLevel } from 'util/logging';

describeProxy('[PGM] Peer group management', () => {

    const haveWebRTC = WebRTCConnection.isAvailable();

    if (!haveWebRTC) {
        console.log('[PGM] WebRTC is not available, skipping some peer group management tests.')
    }

    if (haveWebRTC) {
        test('[PGM01] 2-peer group set up (wrtc)', async (done) => {

            await twoPeerGroupTest(done, 'wrtc', 'no-discovery');
            
        }, 300000);
    }

    test('[PGM02] 2-peer group set up (ws)', async (done) => {

        await twoPeerGroupTest(done, 'ws', 'no-discovery', 6000);

    }, 300000);

    if (haveWebRTC) {
        test('[PGM03] 2-peer group set up (mix)', async (done) => {

            await twoPeerGroupTest(done, 'mix', 'no-discovery', 6100);

        }, 300000);

        test('[PGM04] 2-peer group set up (wrtc) with peer discovery', async (done) => {

            await twoPeerGroupTest(done, 'wrtc', 'linkup-discovery');

        }, 300000);

        test('[PGM05] 4-peer group clique set up (wrtc)', async (done) => {

            await fourPeerCliqueGroupTest(done, 'wrtc', 'no-discovery');

        }, 300000);
    }

    test('[PGM06] 4-peer group clique set up (ws)', async (done) => {

        await fourPeerCliqueGroupTest(done, 'ws', 'no-discovery', 7000);

    }, 300000);

    if (haveWebRTC) {
        test('[PGM07] 4-peer group clique set up (mix)', async (done) => {

            await fourPeerCliqueGroupTest(done, 'mix', 'no-discovery', 6110);

        }, 300000);

        test('[PGM08] 4-peer group clique set up (wrtc) with peer discovery', async (done) => {

            await fourPeerCliqueGroupTest(done, 'wrtc', 'linkup-discovery');

        }, 400000);

        test('[PGM09] 4-peer group clique set up (wrtc) with peer discovery and a shared secret', async (done) => {

            await fourPeerCliqueGroupTest(done, 'wrtc', 'linkup-discovery-secret');

        }, 400000);
    }
});

async function twoPeerGroupTest(done: (() => void), network: 'wrtc'|'ws'|'mix' = 'wrtc', discovery:'linkup-discovery'|'no-discovery', basePort?: number) {

    let peerGroupId = new RNGImpl().randomHexString(64);
    let pods = await TestPeerGroupPods.generate(peerGroupId, 2, 2, 1, network, discovery, basePort);
    pods;



    let control0 = pods[0].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerGroupId)) as PeerGroupAgent;

    let checks = 0;
    let stats = control0.getStats();
    while (stats.peers < 1 /*|| stats.peers !== stats.connections*/) {
        await new Promise(r => setTimeout(r, 100));
        if (checks>1500) {
            break;
        }
        checks++;
        stats = control0.getStats();
    }

    informSituation(control0, 1);

    expect(control0.getPeers().length).toEqual(1);
    /*expect(stats.connections).toEqual(stats.peers);*/

    for (const pod of pods) {
        pod.shutdown();
    }

    done();
}

async function fourPeerCliqueGroupTest(done: () => void, network: 'wrtc'|'ws'|'mix' = 'wrtc', discovery:'linkup-discovery'|'linkup-discovery-secret'|'no-discovery', basePort?: number) {

    let peerGroupId = new RNGImpl().randomHexString(64);
    let pods = await TestPeerGroupPods.generate(peerGroupId, 4, 4, 3, network, discovery, basePort);

    let control0 = pods[0].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerGroupId)) as PeerGroupAgent;

    //control0.controlLog = new Logger('mesh-debug-control', LogLevel.TRACE);
    //control0.peersLog   = new Logger('mesh-debug-peers', LogLevel.TRACE);

    let checks = 0;
    let stats = control0.getStats();
    while (stats.peers < 3 || stats.peers !== stats.connections) {
        await new Promise(r => setTimeout(r, 100));
        if (checks>2500) {
            
            break;
        }
        checks++;
        stats = control0.getStats();
    }



    informSituation(control0, 3);


    expect(control0.getPeers().length).toEqual(3);
    /*expect(stats.connections).toEqual(stats.peers);*/

    for (const pod of pods) {
        pod.shutdown();
    }

    done();
}

function informSituation(control0: PeerGroupAgent, expectedPeers: number) {
    if (control0.getPeers().length !== expectedPeers) {
        let stats = control0.getStats();

        let info = 'peers:       ' + stats.peers + ' (expected ' + expectedPeers + ')\n' +
                   'connections: ' + stats.connections + '\n';

        for (const [status, count] of stats.connectionsPerStatus.entries()) {
            info = info + '    ' + status + ': ' + count + '\n';
        }

        info = info + 'cumulative stats:\n' +
                        '    initiated  conns: ' + control0.stats.connectionInit + '\n' +
                        '    accepted conns:   ' + control0.stats.connectionAccpt + '\n' +
                        '    timout conns:     ' + control0.stats.connectionAccpt + '\n';

        console.log(info);
    }
}