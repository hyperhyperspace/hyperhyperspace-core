
import { RNGImpl } from 'crypto/random';
import { AgentPod } from 'mesh/base/AgentPod';
import { TestConnectionAgent } from '../mock/TestConnectionAgent';
import { NetworkAgent } from 'mesh/agents/network';
import { LinkupManager } from 'net/linkup';
import { describeProxy } from 'test/config';

let linkupServer = LinkupManager.defaultLinkupServer;

describeProxy('Basic networking', () => {

    test('2-node network test', async (done) => {


        let n1 = new AgentPod();
        let na1 = new NetworkAgent();
        n1.registerAgent(na1);
        let n2 = new AgentPod();
        let na2 = new NetworkAgent();
        n2.registerAgent(na2);

        let name1 = new RNGImpl().randomHexString(64);
        let name2 = new RNGImpl().randomHexString(64);

        let ep1 = linkupServer + '/' + name1;
        let ep2 = linkupServer + '/' + name2;

        let a1 = new TestConnectionAgent();
        let a2 = new TestConnectionAgent();

        n1.registerAgent(a1);
        n2.registerAgent(a2);

        a1.expectConnection(ep2, ep1);

        expect(a2.isConnected(ep2, ep1)).toBeFalsy();

        a2.connect(ep2, ep1);

        let checks = 0;
        while (!(a1.isConnected(ep1, ep2) && a2.isConnected(ep2, ep1))) {
            await new Promise(r => setTimeout(r, 50));
            if (checks>400) {
                break;
            }
            checks++;
        }

        expect(a1.isConnected(ep1, ep2) && a2.isConnected(ep2, ep1)).toBeTruthy();

        expect(a1.send(ep1, ep2, 'hello a2')).toBeTruthy();

        checks = 0;
        while (a2.getReceivedMessages(ep1, ep2).size === 0) {
            await new Promise(r => setTimeout(r, 50));
            if (checks>400) {
                break;
            }
            checks++;
        }

        expect(a2.getReceivedMessages(ep1, ep2).has('hello a2')).toBeTruthy();

        expect(a2.send(ep2, ep1, 'hello a1')).toBeTruthy();

        checks = 0;
        while (a1.getReceivedMessages(ep2, ep1).size === 0) {
            await new Promise(r => setTimeout(r, 50));
            if (checks>400) {
                break;
            }
            checks++;
        }

        expect(a1.getReceivedMessages(ep2, ep1).has('hello a2')).toBeFalsy();
        expect(a1.getReceivedMessages(ep2, ep1).has('hello a1')).toBeTruthy();

        done();
    }, 25000);
});