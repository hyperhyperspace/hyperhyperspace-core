import { Swarm } from 'sync/swarm';
import { TestPeerControlAgent } from './agents/TestPeerControlAgent';
import { RNGImpl } from 'crypto/random';
import { NullAgent } from './agents/NullAgent';



describe('Basic swarming', () => {
    test('2-peer swarm set up', async (done) => {

        const hash = new RNGImpl().randomHexString(64);

        let swarm1 = new Swarm(hash);
        let swarm2 = new Swarm(hash);

        const id1 = new RNGImpl().randomHexString(128);
        const id2 = new RNGImpl().randomHexString(128);

        let peerCtrl1 = new TestPeerControlAgent(id1, [id2]);

        let peerCtrl2 = new TestPeerControlAgent(id2, [id1]);

        swarm1.registerAgent(peerCtrl1);

        swarm2.registerAgent(peerCtrl2);

        Swarm.logger.debug('tick0');

        let checks = 0;
        while (swarm1.getPeersWithAgent(peerCtrl2.getId()).length === 0) {
            await new Promise(r => setTimeout(r, 50));
            if (checks>200) {
                break;
            }
            checks++;
            Swarm.logger.debug('tick');
        }


        expect(swarm1.getPeersWithAgent(peerCtrl2.getId()).length).toEqual(1);

        swarm1.shutdown();
        swarm2.shutdown();

        done();

    }, 20000);

    test('3-peer swarm set up', async (done) => {

        const hash = new RNGImpl().randomHexString(64);

        let swarm1 = new Swarm(hash);
        let swarm2 = new Swarm(hash);
        let swarm3 = new Swarm(hash);

        const id1 = new RNGImpl().randomHexString(128);
        const id2 = new RNGImpl().randomHexString(128);
        const id3 = new RNGImpl().randomHexString(128);

        let peerCtrl1 = new TestPeerControlAgent(id1, [id2, id3]);

        let peerCtrl2 = new TestPeerControlAgent(id2, [id1, id3]);

        let peerCtrl3 = new TestPeerControlAgent(id3, [id1, id2])

        swarm1.registerAgent(peerCtrl1);

        swarm2.registerAgent(peerCtrl2);

        swarm3.registerAgent(peerCtrl3);

        Swarm.logger.debug('tick0');

        let checks = 0;
        while (swarm1.getPeersWithAgent(peerCtrl2.getId()).length < 2) {
            await new Promise(r => setTimeout(r, 50));
            if (checks>200) {
                break;
            }
            checks++;
            Swarm.logger.debug('tick');
        }

        expect(swarm1.getPeersWithAgent(peerCtrl2.getId()).length).toEqual(2);
        
        swarm1.shutdown();
        swarm2.shutdown();
        swarm3.shutdown();

        done();

    }, 20000);

    

    test('2-peer agent set sync', async (done) => {

        const hash = new RNGImpl().randomHexString(64);

        let swarm1 = new Swarm(hash);
        let swarm2 = new Swarm(hash);

        const id1 = new RNGImpl().randomHexString(128);
        const id2 = new RNGImpl().randomHexString(128);

        let peerCtrl1 = new TestPeerControlAgent(id1, [id2]);

        //await new Promise(r => setTimeout(r, 2000));

        let peerCtrl2 = new TestPeerControlAgent(id2, [id1]);

        swarm1.registerAgent(peerCtrl1);
        swarm2.registerAgent(peerCtrl2);

        Swarm.logger.debug('tick0');

        let count = 0;
        while (swarm1.getPeersWithAgent(peerCtrl2.getId()).length === 0) {
            await new Promise(r => setTimeout(r, 50));
            if (count>200) {
                break;
            }
            count++;
            Swarm.logger.debug('tick');
        }

        expect(swarm1.getPeersWithAgent(peerCtrl2.getId()).length).toEqual(1);

        const nullAgent = new NullAgent();

        expect(swarm2.getPeersWithAgent(nullAgent.getId()).length).toEqual(0);

        swarm1.registerAgent(nullAgent);

        while (swarm2.getPeersWithAgent(nullAgent.getId()).length === 0) {
            await new Promise(r => setTimeout(r, 50));
            if (count>200) {
                break;
            }
            count++;
            Swarm.logger.debug('tick');
        }

        expect(swarm2.getPeersWithAgent(nullAgent.getId()).length).toEqual(1);

        swarm1.shutdown();
        swarm2.shutdown();

        done();

    }, 20000);

});