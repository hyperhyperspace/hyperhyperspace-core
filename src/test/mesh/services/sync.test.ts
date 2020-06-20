import { Store, IdbBackend } from "data/storage";
import { PeerGroupSyncService } from 'mesh/services/sync/PeerGroupSyncService';
import { SamplePeer } from '../types/SamplePeer';
import { Identity, RSAKeyPair } from 'data/identity';
import { Hash } from 'data/model';
import { RNGImpl } from 'crypto/random';
import { SamplePeerSource } from '../types/SamplePeerSource';
import { MutableSet } from 'data/collections';
import { Logger, LogLevel } from 'util/logging';
import { TerminalOpsSyncAgent } from 'mesh/agents/state';
import { describeProxy } from 'test/config';

describeProxy('Sync services', () => {

    test('2-node sync service test', async (done) => {

        const size = 2;

        let groupId = new RNGImpl().randomHexString(32);

        let samplePeers  : Array<SamplePeer> = [];
        let syncServices : Array<PeerGroupSyncService> = [];
        let stores : Array<Store> = [];

        let allPeers = new Map<Hash, SamplePeer>();
        
        for (let i=0; i<size; i++) {
            let id = Identity.fromKeyPair({'order': i}, RSAKeyPair.generate(512));
            let samplePeer = new SamplePeer(id);
            let store = new Store(new IdbBackend('store-for-peer-' + id.hash()));
            store.save(samplePeer);
            allPeers.set(samplePeer.hash(), samplePeer);
            samplePeers.push(samplePeer);
            stores.push(store);
        }

        for (let i=0; i<size; i++) {
            let store = stores[i];
            let samplePeer = samplePeers[i];
            let samplePeerSource = new SamplePeerSource(store, allPeers);
            let syncService = new PeerGroupSyncService(groupId, samplePeer.getPeer(), samplePeerSource, true);
            
            syncServices.push(syncService);

            let peers = new MutableSet();
            peers.setId(groupId + '-peers');
            peers.add(samplePeer);
            await store.save(peers);

            syncService.addObject(peers);

            let data = new MutableSet();
            data.setId(groupId + '-data');
            await store.save(data);

            syncService.addObject(data);
        }

        let peers = new MutableSet();
        peers.setId(groupId + '-peers');

        peers = await stores[1].load(peers.hash()) as MutableSet<SamplePeer>;

        let logger = new Logger('2-sync test');
        logger.setLevel(LogLevel.INFO);

        {
            let gossip = syncServices[0].gossip;
            gossip;
            gossip.controlLog     = logger;
            gossip.peerMessageLog = logger;
        }

        {
            let peersSync = syncServices[0].syncAgents.get(peers.hash()) as TerminalOpsSyncAgent;
            peersSync;
            peersSync.controlLog     = logger;
            peersSync.peerMessageLog = logger;
            peersSync.opTransferLog  = logger;
        }

        {
            let peerNetwork = syncServices[0].peerNetwork;
            peerNetwork;
            //peerNetwork.controlLog = logger;
        }
        
        syncServices[0].start();

        

        await new Promise(r => setTimeout(r, 50));

        syncServices[1].start();

        await peers.loadAllOpsFromStore();

        let ticks = 0;
        while (peers.size() < 2 && ticks++ < 400) {
            await new Promise(r => setTimeout(r, 50));
            await peers.loadAllOpsFromStore();
        }

        expect(syncServices[0].peerNetwork.getPeers().length).toEqual(1);
        expect(peers.size()).toEqual(2);
        done();
    }, 35000);
});