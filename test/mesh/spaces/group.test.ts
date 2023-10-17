import { SharedNamespace } from 'mesh/share';
import { SamplePeer } from '../types/SamplePeer';
import { Identity, RSAKeyPair } from 'data/identity';
import { Hash } from 'data/model';
import { RNGImpl } from 'crypto/random';
import { SamplePeerSource } from '../types/SamplePeerSource';
import { MutableSet } from 'data/collections';
import { Logger, LogLevel } from 'util/logging';
import { PeerGroupAgent } from 'mesh/agents/peer';
import { describeProxy } from 'config';
import { WebRTCConnection } from 'index';



describeProxy('[SPA] Group shared spaces', () => {

    if (WebRTCConnection.isAvailable()) {        
        test('[SPA01] 3-node sync test', async (done) => {

            const size = 3;

            let spaceId = new RNGImpl().randomHexString(32);

            let samplePeers = await generateSamplePeers(size);
            let spaces      = generateSpacesForPeers(spaceId, samplePeers);


            for (let i=0; i<size; i++) {
                let samplePeer = samplePeers[i];
                let space = spaces[i];

                space.connect();

                let peers = new MutableSet();
                await space.attach('peers', peers);
                await peers.add(samplePeer);
                await peers.saveQueuedOps();

                let data = new MutableSet();
                await space.attach('data', data);
                
            }

            let peers = await spaces[1].get('peers') as MutableSet<SamplePeer>;

            let logger = new Logger('3-sync test');
            logger.setLevel(LogLevel.INFO);


            //connectSpaceWithLogger(spaces[0], logger);
        
            /*{
                let peersSync = spaces[0].syncAgents.get(peers.hash()) as TerminalOpsSyncAgent;
                peersSync;
                peersSync.controlLog     = logger;
                peersSync.peerMessageLog = logger;
                peersSync.opTransferLog  = logger;
            }*/   

            await new Promise(r => setTimeout(r, 50));

            await peers.loadAllChanges();

            let ticks = 0;
            while (((spaces[0].mesh.pod.getAgent(PeerGroupAgent.agentIdForPeerGroup(spaces[0].spaceId)) as PeerGroupAgent).getPeers().length < size-1 || 
                peers.size() < size) 
                && ticks++ < 800) {
                await new Promise(r => setTimeout(r, 50));
                await peers.loadAllChanges();
                //console.log(ticks);
                
                //let pc = (spaces[0].mesh.pod.getAgent(PeerMeshAgent.agentIdForMesh(spaces[0].spaceId)) as PeerMeshAgent).getPeers().length;
                //console.log('peers: ' + pc);
            }

            expect((spaces[0].mesh.pod.getAgent(PeerGroupAgent.agentIdForPeerGroup(spaces[0].spaceId)) as PeerGroupAgent).getPeers().length).toEqual(size-1);
            expect(peers.size()).toEqual(size);
            
            for (const space of spaces) {
                space.mesh.pod.shutdown();
            }
            
            done();
            
        }, 300000);

        test('[SPA02] 2-node nested sync test', async (done) => {

            const size = 2;

            let spaceId = new RNGImpl().randomHexString(32);

            let samplePeers = await generateSamplePeers(size);
            let spaces      = generateSpacesForPeers(spaceId, samplePeers);


            for (let i=0; i<size; i++) {
                let space = spaces[i];

                let things = new MutableSet();
                space.connect();
                await space.attach('things', things);
                
            }

            let things = await spaces[0].get('things') as MutableSet<MutableSet<SamplePeer>>;

            let inner = new MutableSet<SamplePeer>();

            await things.add(inner);
            await things.saveQueuedOps();

            await inner.add(samplePeers[0]);
            await inner.saveQueuedOps();

            let logger = new Logger('2-way nested sync test');
            logger.setLevel(LogLevel.INFO);

            //startSpaceWithLogger(spaces[0], logger);  

            /*{
                let logger = new Logger('things sync');
                logger.setLevel(LogLevel.TRACE);
                let peersSync = spaces[0].syncAgents.get(things.hash()) as TerminalOpsSyncAgent;
                peersSync;
                peersSync.controlLog     = logger;
                peersSync.peerMessageLog = logger;
                peersSync.opTransferLog  = logger;
            }   

            {
                let logger = new Logger('inner sync');
                logger.setLevel(LogLevel.TRACE);
                let peersSync = spaces[0].syncAgents.get(inner.hash()) as TerminalOpsSyncAgent;
                peersSync;
                peersSync.controlLog     = logger;
                peersSync.peerMessageLog = logger;
                peersSync.opTransferLog  = logger;
            } */


            let lastThings = spaces[size-1].get('things') as MutableSet<MutableSet<SamplePeer>>;
            lastThings.loadAllChanges();

            let ticks = 0;
            while (ticks++ < 1200 && lastThings.size() < 1) {
                await new Promise(r => setTimeout(r, 50));
                await lastThings?.loadAllChanges();
                //console.log('T'+ticks);
            }

            expect(lastThings.size()).toEqual(1);

            let lastInner = lastThings?.size() > 0 ? lastThings.values().next().value : undefined;

            ticks = 0;
            while (lastInner !== undefined && ticks++ < 1200 && (lastInner?.size() === 0)) {
                await new Promise(r => setTimeout(r, 50));
                await lastInner.loadAllChanges();
                //console.log('I'+ticks);
            }

            let samplePeer = lastInner?.size() > 0 ? lastInner.values().next().value : undefined;

            //expect((spaces[0].mesh.pod.getAgent(PeerGroupAgent.agentIdForPeerGroup(spaces[0].spaceId)) as PeerGroupAgent).getPeers().length).toEqual(size-1);
            
            expect(lastInner.size()).toEqual(1);
            expect(samplePeer?.hash()).toEqual(samplePeers[0].hash());

            for (const space of spaces) {
                space.mesh.pod.shutdown();
            }

            done();
        }, 300000);
    } else {
        test('[SPA] sync test (omitted)', async (done) => {
            done();
        });
    }
});


let generateSamplePeers = async (size: number) => {

    let samplePeers = new Array<SamplePeer>();
    for (let i=0; i<size; i++) {
        let id = Identity.fromKeyPair({'order': i}, await RSAKeyPair.generate(1024));
        let samplePeer = new SamplePeer(id);
        samplePeers.push(samplePeer);
    }

    return samplePeers;
}

let hashSamplePeers = (samplePeers: Array<SamplePeer>) => {

    let hashedPeers = new Map<Hash, SamplePeer>();
    for (let samplePeer of samplePeers) {
        hashedPeers.set(samplePeer.hash(), samplePeer);
    }

    return hashedPeers;
}

let generateSpacesForPeers = (spaceId: string, samplePeers: Array<SamplePeer>) => {

    let allPeers = hashSamplePeers(samplePeers);

    let spaces = new Array<SharedNamespace>();

    for (let i=0; i<samplePeers.length; i++) {
        let samplePeer = samplePeers[i];
        let space = new SharedNamespace(spaceId, samplePeer.getPeer(), {peerGroupAgentConfig: { tickInterval: 1.5, peerConnectionAttemptInterval: 15, peerConnectionTimeout: 14 }});
        let samplePeerSource = new SamplePeerSource(space.getStore(), allPeers);
        space.setPeerSource(samplePeerSource);
        spaces.push(space);
    }

    return spaces;
}