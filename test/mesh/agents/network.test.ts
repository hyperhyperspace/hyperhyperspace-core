
import { RNGImpl } from 'crypto/random';
import { AgentPod } from 'mesh/service/AgentPod';
import { TestConnectionAgent } from '../mock/TestConnectionAgent';
import { NetworkAgent } from 'mesh/agents/network';
import { LinkupManager } from 'net/linkup';
import { describeProxy } from 'config';
import { WebRTCConnection } from 'index';

let linkupServer = LinkupManager.defaultLinkupServer;

describeProxy('[NET] Basic networking', () => {

    const haveWebRTC = WebRTCConnection.isAvailable();

    if (!haveWebRTC) {
        console.log('[NET] WebRTC is not available, skipping some networking tests.')
    }

    if (haveWebRTC) {
        test('[NET01] 2-node network test (wrtc)', async (done) => {

            await twoNodeNetworkTest(linkupServer, linkupServer, done);

        }, 45000);
    }

    test('[NET02] 2-node network test (ws)', async (done) => {

        await twoNodeNetworkTest('ws://localhost:10110', 'ws://localhost:10111', done);

    }, 45000);

    if (haveWebRTC) {
        test('[NET03] 2-node network test (mixed)', async (done) => {

            await twoNodeNetworkTest( 'ws://localhost:10112', linkupServer, done);

        }, 45000);
    }
});

async function twoNodeNetworkTest(linkupHost1: string, linkupHost2: string, done: () => void) {
    let n1 = new AgentPod();
    let na1 = new NetworkAgent();
    n1.registerAgent(na1);
    let n2 = new AgentPod();
    let na2 = new NetworkAgent();
    n2.registerAgent(na2);

    let name1 = new RNGImpl().randomHexString(64);
    let name2 = new RNGImpl().randomHexString(64);

    let ep1 = linkupHost1 + '/' + name1;
    let ep2 = linkupHost2 + '/' + name2;

    let a1 = new TestConnectionAgent();
    let a2 = new TestConnectionAgent();

    n1.registerAgent(a1);
    n2.registerAgent(a2);

    a1.expectConnection(ep2, ep1);

    expect(a2.isConnected(ep2, ep1)).toBeFalsy();

    a2.connect(ep2, ep1);

    let checks = 0;
    while (!(a1.isConnected(ep1, ep2) && a2.isConnected(ep2, ep1))) {
        await new Promise(r => setTimeout(r, 100));
        if (checks>400) {
            break;
        }
        checks++;
    }

    expect(a1.isConnected(ep1, ep2) && a2.isConnected(ep2, ep1)).toBeTruthy();

    expect(a1.send(ep1, ep2, 'hello a2')).toBeTruthy();

    checks = 0;
    while (a2.getReceivedMessages(ep1, ep2).size === 0) {
        await new Promise(r => setTimeout(r, 100));
        if (checks>400) {
            break;
        }
        checks++;
    }

    expect(a2.getReceivedMessages(ep1, ep2).has('hello a2')).toBeTruthy();

    expect(a2.send(ep2, ep1, 'hello a1')).toBeTruthy();

    checks = 0;
    while (a1.getReceivedMessages(ep2, ep1).size === 0) {
        await new Promise(r => setTimeout(r, 100));
        if (checks>400) {
            break;
        }
        checks++;
    }

    expect(a1.getReceivedMessages(ep2, ep1).has('hello a2')).toBeFalsy();
    expect(a1.getReceivedMessages(ep2, ep1).has('hello a1')).toBeTruthy();

    n1.shutdown();
    n2.shutdown();

    done();
}