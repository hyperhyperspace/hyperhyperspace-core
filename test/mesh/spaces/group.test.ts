import { GroupSharedSpace } from 'mesh/spaces';
import { SamplePeer } from '../types/SamplePeer';
import { Identity, RSAKeyPair } from 'data/identity';
import { Hash } from 'data/model';
import { RNGImpl } from 'crypto/random';
import { SamplePeerSource } from '../types/SamplePeerSource';
import { MutableSet } from 'data/collections';
import { Logger, LogLevel } from 'util/logging';
import { TerminalOpsSyncAgent } from 'mesh/agents/state';
import { PeerMeshAgent } from 'mesh/agents/peer';
import { NetworkAgent } from 'mesh/agents/network';
import { StateGossipAgent } from 'mesh/agents/state'
import { describeProxy } from 'config';

describeProxy('Group shared spaces', () => {

    test('2-node sync test', async (done) => {

        const size = 2;

        let spaceId = new RNGImpl().randomHexString(32);

        let samplePeers  : Array<SamplePeer> = [];
        let spaces : Array<GroupSharedSpace> = [];
        //let stores : Array<Store> = [];

        let allPeers = new Map<Hash, SamplePeer>();
        
        for (let i=0; i<size; i++) {
            let id = Identity.fromKeyPair({'order': i}, RSAKeyPair.generate(512));
            let samplePeer = new SamplePeer(id);
            //let store = new Store(new IdbBackend('store-for-peer-' + id.hash()));
            //store.save(samplePeer);
            allPeers.set(samplePeer.hash(), samplePeer);
            samplePeers.push(samplePeer);
            //stores.push(store);
        }

        for (let i=0; i<size; i++) {
            let samplePeer = samplePeers[i];
            let space = new GroupSharedSpace(spaceId, samplePeer.getPeer());
            let samplePeerSource = new SamplePeerSource(space.getStore(), allPeers);
            space.setPeerSource(samplePeerSource);
            spaces.push(space);

            let peers = new MutableSet();
            await space.attach('peers', peers);
            await peers.add(samplePeer);
            await peers.saveQueuedOps();

            let data = new MutableSet();
            await space.attach('data', data);

            
        }

        //let peers = new MutableSet();
        //peers.setId(spaceId + '-peers');

        let peers = await spaces[1].getAttached('peers') as MutableSet<SamplePeer>;
        //peers = await spaces[1].getStore().load(peers.hash()) as MutableSet<SamplePeer>;

        let logger = new Logger('2-sync test');
        logger.setLevel(LogLevel.INFO);

        spaces[0].init();

        {
            let network = spaces[0].network as NetworkAgent;
            network;
            network.logger = logger;
            network.connLogger = logger;
            network.messageLogger = logger;

        }

        {
            let gossip = spaces[0].gossip as StateGossipAgent;
            gossip;
            gossip.controlLog     = logger;
            gossip.peerMessageLog = logger;
        }

        {
            let peerMesh = spaces[0].peerMesh as PeerMeshAgent;
            peerMesh;
            peerMesh.controlLog = logger;
        }

        spaces[0].start();

        {
            let peersSync = spaces[0].syncAgents.get(peers.hash()) as TerminalOpsSyncAgent;
            peersSync;
            peersSync.controlLog     = logger;
            peersSync.peerMessageLog = logger;
            peersSync.opTransferLog  = logger;
        }        

        await new Promise(r => setTimeout(r, 50));

        spaces[1].start();

        await peers.loadAllOpsFromStore();

        let ticks = 0;
        while (((spaces[0].peerMesh as PeerMeshAgent).getPeers().length < 1 || 
               peers.size() < 2) 
               && ticks++ < 400) {
            await new Promise(r => setTimeout(r, 50));
            await peers.loadAllOpsFromStore();
            //console.log(ticks);
        }

        expect((spaces[0].peerMesh as PeerMeshAgent).getPeers().length).toEqual(1);
        expect(peers.size()).toEqual(2);
        done();
    }, 35000);
});