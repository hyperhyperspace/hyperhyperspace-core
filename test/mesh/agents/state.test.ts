import { TestPeerGroupPods } from '../mock/TestPeerGroupPods';

import { TestIdentity } from 'data/types/TestIdentity';

import { StateGossipAgent } from 'mesh/agents/state/StateGossipAgent';
import { PeerGroupAgent } from 'mesh/agents/peer';
import { Hash, HashedLiteral, HashedObject } from 'data/model';
import { RNGImpl } from 'crypto/random';
import { LinearStateAgent } from '../mock/LinearStateAgent';
import { Store } from 'storage/store';
import { IdbBackend, MemoryBackend } from 'storage/backends';
import { MutableSet } from 'data/containers';
import { Identity } from 'data/identity';
import { describeProxy } from 'config';
import { HeaderBasedSyncAgent, HistorySynchronizer, TerminalOpsSyncAgent } from 'mesh/agents/state';
import { Logger, LogLevel } from 'util/logging';
import { Resources } from 'spaces/Resources';
import { NetworkAgent } from 'mesh/agents/network';
import { SQLiteBackend } from '../../../../sqlite/dist';

describeProxy;

describeProxy('[SYN] State sync', () => {
    test('[SYN01] Gossip agent in small peer group (wrtc)', async (done) => {

        await gossipInSmallPeerGroup(done, 'wrtc');

    }, 300000);

    test('[SYN02] Gossip agent in small peer group (ws)', async (done) => {

        await gossipInSmallPeerGroup(done, 'ws', 5200);

    }, 300000);

    test('[SYN03] Gossip agent in small peer group (mix)', async (done) => {

        await gossipInSmallPeerGroup(done, 'mix', 5210);

    }, 300000);

    test('[SYN04] Causal history agent-based set sync in small peer group (wrtc)', async (done) => {

        await syncInSmallPeerGroup(done, 'wrtc');

    }, 300000);

    test('[SYN05] Causal history agent-based set sync in small peer group (wrtc), using SQLite', async (done) => {

        await syncInSmallPeerGroup(done, 'wrtc', undefined, undefined, true);

    }, 300000);


    test('[SYN06] Causal history agent-based set sync in small peer group (ws)', async (done) => {

        await syncInSmallPeerGroup(done, 'ws', 5300);
    }, 300000);

    test('[SYN07] Causal history agent-based set sync in small peer group (mix)', async (done) => {

        await syncInSmallPeerGroup(done, 'mix', 5310);
    }, 300000);

    test('[SYN08] Causal history agent-based set sync in small peer group (wrtc) w/remoting', async (done) => {

        await syncInSmallPeerGroup(done, 'wrtc', undefined, true);

    }, 300000);

    test('[SYN09] Causal history agent-based set staged sync in small peer group (wrtc)', async (done) => {

        await stagedSyncInSmallPeerGroup(done, 'wrtc');

    }, 300000);

    test('[SYN10] Causal history agent-based set deep sync in small peer group with faulty network (disabled) (wrtc)', async (done) => {

        await deepSyncInSmallPeerGroup(done, 'wrtc', undefined, undefined, false);

    }, 300000);

    test('[SYN11] Causal history agent-based set diamond-shaped sync in small peer group (wrtc)', async (done) => {

        await diamondSyncInSmallPeerGroup(done, 'wrtc');

    }, 300000);

    test('[SYN12] Causal history agent-based set deep sync in small peer group (wrtc)', async (done) => {

        await deepSyncInSmallPeerGroup(done, 'wrtc', undefined, undefined);

    }, 300000);

});

async function gossipInSmallPeerGroup(done: () => void, network: 'wrtc'|'ws'|'mix' = 'wrtc', basePort?: number) {

    let peerGroupId = new RNGImpl().randomHexString(64);
    let pods = await TestPeerGroupPods.generate(peerGroupId, 3, 3, 2, network, 'no-discovery', basePort);

    const objCount = 3;
    const objIds   = new Array<Hash>();
    for (let i=0; i<objCount; i++) {
        objIds.push(new RNGImpl().randomHexString(32));
    }

    for (const pod of pods) {
        const peerNetwork = pod.getAgent(PeerGroupAgent.agentIdForPeerGroup(peerGroupId)) as PeerGroupAgent;
        const gossip = new StateGossipAgent(peerGroupId, peerNetwork);
        pod.registerAgent(gossip);
        for (let i=0; i<objCount; i++) {
            let agent = new LinearStateAgent(objIds[i], peerNetwork);
            gossip.trackAgentState(agent.getAgentId());
            pod.registerAgent(agent);
        }
    }

    let seq0:Array<[number, string]> = [[0, 'zero'],[1,'one'], [2, 'two']];
    let seq1:Array<[number, string]> = [[10, 'a'], [10, 'b'], [3, 'three']]
    let seq2:Array<[number, string]> = [[11, 'eleven'], [10, 'ten'], [9, 'nine']];

    await new Promise<void>(r => { window.setTimeout(() => { r() }, 1000);  });

    let seqs = [seq0, seq1, seq2];
    let witness: Array<LinearStateAgent> = [];
    let results: Array<[number, string]> = [[2, 'two'], [10, 'b'], [11, 'eleven']];

    for (let i=0; i<objCount; i++) {

        let objId = objIds[i];


        let seq = seqs[i];

        let c=0;
        for (let j=0; c<3; j++) {
            await new Promise(r => { window.setTimeout( r, 100); });
            let agent=pods[j].getAgent(LinearStateAgent.createId(objId)) as LinearStateAgent;
            if (agent !== undefined) {
                if (c<3) {
                    seq
                    agent.setMessage(seq[c][1], seq[c][0]);
                } else {
                    witness.push(agent);
                }
                c=c+1;
            }
        }

        let finished = false;
        let checks = 0;
        while (! finished && checks < 2500) {
            
            await new Promise(r => { window.setTimeout( r, 100); });

            finished = true;
            for (let c=0; c<3 && finished; c++) {

                if (witness.length <= c) continue;

                finished = finished && witness[c].seq === results[c][0];
                finished = finished && witness[c].message === results[c][1];
            }
            checks = checks + 1;
            
        }

        for (let c=0; c<3; c++) {

            if (witness.length <= c) continue;

            expect(witness[c].seq).toEqual(results[c][0]);
            expect(witness[c].message).toEqual(results[c][1])
        }

    }

    for (const pod of pods) {
        pod.shutdown();
    }

    done();

}

async function syncInSmallPeerGroup(done: () => void, network: 'wrtc'|'ws'|'mix' = 'wrtc', basePort?: number, useRemoting?: boolean, useSQLite=false) {

    const size = 3;
        
    let peerNetworkId = new RNGImpl().randomHexString(64);

    let pods = await TestPeerGroupPods.generate(peerNetworkId, size, size, size-1, network, 'no-discovery', basePort, useRemoting);

    let stores : Array<Store> = [];
    
    for (let i=0; i<size; i++) {
        const peerNetwork = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        const store = new Store(useSQLite? new SQLiteBackend('test'+i) : new IdbBackend('store-for-peer-' + peerNetwork.getLocalPeer().endpoint));
        stores.push(store);
        let gossip = new StateGossipAgent(peerNetworkId, peerNetwork);
        
        pods[i].registerAgent(gossip);
    }

    let id = await TestIdentity.getFirstTestIdentity();
    let kp = await TestIdentity.getFistTestKeyPair();
    
    let s = new MutableSet<Identity>();
    
    s.setAuthor(id);
    
    await stores[0].save(kp);
    await stores[0].save(s);

    for (let i=0; i<size; i++) {
        TerminalOpsSyncAgent.toString
        const peerGroupAgent = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        
        //let agent = new TerminalOpsSyncAgent(peerGroupAgent, s.hash(), stores[i], MutableSet.opClasses);
        let agent = new HeaderBasedSyncAgent(peerGroupAgent, s.hash(),  await Resources.create({store: stores[i]}), MutableSet.opClasses);
        let gossip = pods[i].getAgent(StateGossipAgent.agentIdForGossip(peerNetworkId)) as StateGossipAgent;
        gossip.trackAgentState(agent.getAgentId());
        //agent;
        pods[i].registerAgent(agent);
    }

    await s.add(id);
    
    await s.delete(id);
    
    await s.add(id);
    
    await s.delete(id);
    
    await s.add(id);
    //stores[size-1].save(sclone);

    //sclone.bindToStore();
    //sclone.loadAllOpsFromStore();

    //await stores[0].load(s.hash());

    await stores[0].save(s);

    //let ctx = s.toContext();

    //console.log(ctx.literals);

    //TestTopology.waitForPeers(swarms, size - 1);

    let meshReady = false;

    let count = 0;

    while (!meshReady && count < 1000) {
        await new Promise(r => setTimeout(r, 100));
        const meshAgent = pods[size-1].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent
        meshReady = meshAgent.getPeers().length === (size-1);
        //console.log(count + '. peers: ' + meshAgent.getPeers().length);
        count = count + 1;
    }


    let replicated = false;

    if (meshReady) {
        count = 0;

        while (!replicated && count < 1500) {

            await new Promise(r => setTimeout(r, 100));

            const sr = await stores[size-1].load(s.hash()) as MutableSet<Identity> | undefined;

            if (sr !== undefined) {
                
                
                await sr.loadAllChanges();
                replicated = sr.size() === 1;
                //for (const elmt of sr.values()) {
                    //console.log('FOUND ELMT:');
                    //console.log(elmt);
                //}
            }

            count = count + 1;
        }
    }



    //const meshAgent = pods[0].getAgent(PeerMeshAgent.agentIdForMesh(peerNetworkId)) as PeerMeshAgent
    //expect(meshAgent.getPeers().length).toEqual(size-1);

    for (const pod of pods) {
        pod.shutdown();
    }

    expect(meshReady).toBeTruthy();
    expect(replicated).toBeTruthy();

    for (let i=0; i<size; i++) {
        //stores[i].close();
    }

    done();
}


async function stagedSyncInSmallPeerGroup(done: () => void, network: 'wrtc'|'ws'|'mix' = 'wrtc', basePort?: number, useRemoting?: boolean) {

    const size = 3;
        
    let peerNetworkId = new RNGImpl().randomHexString(64);

    let pods = await TestPeerGroupPods.generate(peerNetworkId, size, size, size-1, network, 'no-discovery', basePort, useRemoting);

    let stores : Array<Store> = [];
    
    for (let i=0; i<size; i++) {
        const peerNetwork = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        const store = new Store(new IdbBackend('store-for-peer-' + peerNetwork.getLocalPeer().endpoint));
        stores.push(store);
        let gossip = new StateGossipAgent(peerNetworkId, peerNetwork);
        
        pods[i].registerAgent(gossip);
    }

    let id = await TestIdentity.getFirstTestIdentity();
    let kp = await TestIdentity.getFistTestKeyPair();
    
    let s = new MutableSet<Identity>();
    
    s.setAuthor(id);
    
    await stores[0].save(kp);
    await stores[0].save(s);

    await s.add(id);

    await stores[0].save(s);

    for (let i=0; i<size; i++) {
        const meshAgent = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        //let agent = new TerminalOpsSyncAgent(meshAgent, s.hash(), stores[i], MutableSet.opClasses);
        let agent = new HeaderBasedSyncAgent(meshAgent, s.hash(), await Resources.create({store: stores[i]}), MutableSet.opClasses);
        let gossip = pods[i].getAgent(StateGossipAgent.agentIdForGossip(peerNetworkId)) as StateGossipAgent;
        gossip.trackAgentState(agent.getAgentId());
        //agent;
        pods[i].registerAgent(agent);
    }


    let meshReady = false;

    let count = 0;

    while (!meshReady && count < 1000) {
        await new Promise(r => setTimeout(r, 100));
        const meshAgent = pods[size-1].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent
        meshReady = meshAgent.getPeers().length === (size-1);
        //console.log(count + '. peers: ' + meshAgent.getPeers().length);
        count = count + 1;
    }

    let replicated = false;

    if (meshReady) {
        count = 0;

        while (!replicated && count < 1500) {

            await new Promise(r => setTimeout(r, 100));

            const sr = await stores[size-1].load(s.hash()) as MutableSet<Identity> | undefined;

            if (sr !== undefined) {
                
                
                await sr.loadAllChanges();
                replicated = sr.size() === 1;
                //for (const elmt of sr.values()) {
                    //console.log('FOUND ELMT:');
                    //console.log(elmt);
                //}
            }

            count = count + 1;
        }
    }
    
    
    await s.add(id);

    await stores[0].save(s);
    
    await s.delete(id);

    //stores[size-1].save(sclone);

    //sclone.bindToStore();
    //sclone.loadAllOpsFromStore();

    //await stores[0].load(s.hash());

    await stores[0].save(s);

    //let ctx = s.toContext();

    //console.log(ctx.literals);

    //TestTopology.waitForPeers(swarms, size - 1);

    


    replicated = false;

    if (meshReady) {
        count = 0;

        while (!replicated && count < 1500) {

            await new Promise(r => setTimeout(r, 100));

            const sr = await stores[size-1].load(s.hash()) as MutableSet<Identity> | undefined;

            if (sr !== undefined) {
                
                
                await sr.loadAllChanges();
                replicated = sr.size() === 0;
                //console.log(Array.from(sr.values()));
                //for (const elmt of sr.values()) {
                    //console.log('FOUND ELMT:');
                    //console.log(elmt);
                //}
            }

            count = count + 1;
        }
    }



    //const meshAgent = pods[0].getAgent(PeerMeshAgent.agentIdForMesh(peerNetworkId)) as PeerMeshAgent
    //expect(meshAgent.getPeers().length).toEqual(size-1);

    for (const pod of pods) {
        pod.shutdown();
    }

    expect(meshReady).toBeTruthy();
    expect(replicated).toBeTruthy();

    done();
}

async function deepSyncInSmallPeerGroup(done: () => void, network: 'wrtc'|'ws'|'mix' = 'wrtc', basePort?: number, useRemoting?: boolean, useFaultyMessaging=false) {

    //PeerGroupAgent.controlLog.setLevel(LogLevel.DEBUG);
    //HistorySynchronizer.controlLog.setLevel(LogLevel.TRACE);
    //HistorySynchronizer.stateLog.setLevel(LogLevel.DEBUG);
    //HistorySynchronizer.opXferLog.setLevel(LogLevel.TRACE);

    HistorySynchronizer.opXferLog;

    const size = 3;

    const depth = 5;
        
    let peerNetworkId = new RNGImpl().randomHexString(64);

    let pods = await TestPeerGroupPods.generate(peerNetworkId, size, size, size-1, network, 'no-discovery', basePort, useRemoting);

    let stores : Array<Store> = [];
    
    for (let i=0; i<size; i++) {
        const peerGroupAgent = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;

        const store = new Store(new MemoryBackend('store-for-peer-' + peerGroupAgent.getLocalPeer().endpoint));
        stores.push(store);
        let gossip = new StateGossipAgent(peerNetworkId, peerGroupAgent);
        
        pods[i].registerAgent(gossip);
    }

    console.log('STORES')

    let id = await TestIdentity.getFirstTestIdentity();
    let kp = await TestIdentity.getFistTestKeyPair();
    
    let s = new MutableSet();
    
    s.setAuthor(id);
    
   

    for (let k=0; k<size; k++) {
        await stores[k].save(kp);
    }

    await stores[0].save(s);

    await s.add(new HashedLiteral('hello'));
    

    await stores[0].save(s);

    let syncAgent: HeaderBasedSyncAgent|undefined = undefined;

    for (let i=0; i<size; i++) {
        const meshAgent = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        //let agent = new TerminalOpsSyncAgent(meshAgent, s.hash(), stores[i], MutableSet.opClasses);
        let agent = new HeaderBasedSyncAgent(meshAgent, s.hash(), await Resources.create({store: stores[i]}), MutableSet.opClasses);
        if (i===0) {

            syncAgent = agent;

            agent.synchronizer.requestLog = new Logger('requests');
            agent.synchronizer.requestLog.setLevel(LogLevel.DEBUG);

            /*agent.synchronizer.controlLog = new Logger('control');
            agent.synchronizer.stateLog = new Logger('state');
            agent.synchronizer.opXferLog = new Logger('xfer');

            agent.synchronizer.controlLog.setLevel(LogLevel.DEBUG);
            agent.synchronizer.stateLog.setLevel(LogLevel.DEBUG);
            agent.synchronizer.opXferLog.setLevel(LogLevel.DEBUG);*/
        
        }
        
        let gossip = pods[i].getAgent(StateGossipAgent.agentIdForGossip(peerNetworkId)) as StateGossipAgent;
        gossip.trackAgentState(agent.getAgentId());
        //agent;
        pods[i].registerAgent(agent);
    }

    console.log('AGENTS')

    let meshReady = false;

    let count = 0;

    while (!meshReady && count < 1000) {
        await new Promise(r => setTimeout(r, 100));
        const meshAgent = pods[size-1].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent
        meshReady = meshAgent.getPeers().length === (size-1);
        /*if (count % 50 === 0) {
            console.log(count + '. peers: ' + meshAgent.getPeers().length);
        }*/
        
        count = count + 1;
    }

    console.log('MESHES')

    let replicated = false;

    if (meshReady) {
        count = 0;


        while (!replicated && count < 1500) {

            await new Promise(r => setTimeout(r, 100));

            replicated = true;


            for (let k=0; k<size; k++) {

                const sr = await stores[k].load(s.hash()) as MutableSet<Identity> | undefined;


                if (sr !== undefined) {
                    
                    
                    await sr.loadAllChanges();
                    replicated = replicated && sr.size() === 1;
                    //for (const elmt of sr.values()) {
                        //console.log('FOUND ELMT:');
                        //console.log(elmt);
                    //}

                } else {
                    replicated = false;
                }
            }

            count = count + 1;
        }
    }
    
    //console.log('0th ELEM ADDED')

    if (replicated) {

        for (let k=0; k<size; k++) {

            const sr = await stores[k].load(s.hash()) as MutableSet<HashedLiteral>;

            await sr.loadAllChanges();

            for (let i=0; i<depth; i++) {
                await sr.add(new HashedLiteral(k + '-hello-' + i));
                await stores[k].save(sr);
                /*if (i % 10 === 9) {
                    console.log('adding ' + i + 'th element to store ' + k);
                }*/
                
            }

        }
    }

    /*
    await s.add(new HashedLiteral('my'));
    await s.add(new HashedLiteral('dear'));
    await s.add(new HashedLiteral('friends'));
    await s.add(new HashedLiteral('I'));
    await s.add(new HashedLiteral('have'));
    await s.add(new HashedLiteral('very'));
    await s.add(new HashedLiteral('dearly'));
    await s.add(new HashedLiteral('missed'));
    await s.add(new HashedLiteral('you'));
    */

    

    console.log('ALL SAVED!')

    for (let i=0; i<size; i++) {
        const network = pods[i].getAgent(NetworkAgent.AgentId) as NetworkAgent;
        network.testingMode = useFaultyMessaging;
    }

    replicated = false;

    if (meshReady) {
        count = 0;

        let sr: Array<MutableSet<HashedObject>|undefined> = [];

        for (let k=0; k<size; k++) {
            sr.push(undefined);
        }

        while (!replicated && count < 1500) {

            await new Promise(r => setTimeout(r, 100));

            replicated = true;

            for (let k=0; k<size; k++) {

                if (sr[k] === undefined) {
                    sr[k] = await stores[k].load(s.hash()) as MutableSet<HashedObject> | undefined;

                    if (sr[k] !== undefined) {
                        await sr[k]?.loadAndWatchForChanges();
                    }
                }
                

                if (sr[k] !== undefined) {
                    
                    replicated = replicated && (sr[k]?.size() === size * depth + 1);
                    if (count % 100 === 0) {
                        console.log((count/10) + 's ['+ k + ']: ' + sr[k]?.size() + ' elements' );
                    }
                    //console.log(Array.from(sr.values()));
                    //for (const elmt of sr.values()) {
                        //console.log('FOUND ELMT:');
                        //console.log(elmt);
                    //}
                } else {
                    replicated = false;
                }
            }

            if (count % 200 === 0) {
                console.log('DIAGNOSTICS:');
                console.log(syncAgent?.synchronizer.selfDiagnostic());
            }

            count = count + 1;
        }
    }



    //const meshAgent = pods[0].getAgent(PeerMeshAgent.agentIdForMesh(peerNetworkId)) as PeerMeshAgent
    //expect(meshAgent.getPeers().length).toEqual(size-1);

    for (const pod of pods) {
        pod.shutdown();
    }

    expect(meshReady).toBeTruthy();
    expect(replicated).toBeTruthy();

    done();
}

async function diamondSyncInSmallPeerGroup(done: () => void, network: 'wrtc'|'ws'|'mix' = 'wrtc', basePort?: number, useRemoting?: boolean) {

    const size = 2;
        
    let peerNetworkId = new RNGImpl().randomHexString(64);

    let pods = await TestPeerGroupPods.generate(peerNetworkId, size, size, size-1, network, 'no-discovery', basePort, useRemoting);

    let stores : Array<Store> = [];
    
    for (let i=0; i<size; i++) {
        const peerNetwork = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        const store = new Store(new IdbBackend('store-for-peer-' + peerNetwork.getLocalPeer().endpoint));
        stores.push(store);
        let gossip = new StateGossipAgent(peerNetworkId, peerNetwork);
        
        pods[i].registerAgent(gossip);
    }

    let kp = await TestIdentity.getFistTestKeyPair();
    
    let s = new MutableSet<HashedObject>();
    
    
    await stores[0].save(kp);
    await stores[0].save(s);

    await s.add(new HashedLiteral('common root'));

    await stores[0].save(s);

    for (let i=0; i<size; i++) {
        const meshAgent = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        //let agent = new TerminalOpsSyncAgent(meshAgent, s.hash(), stores[i], MutableSet.opClasses);
        let agent = new HeaderBasedSyncAgent(meshAgent, s.hash(), await Resources.create({store: stores[i]}), MutableSet.opClasses);
        
        agent.synchronizer.controlLog = new Logger('synchronizer', LogLevel.INFO);
        agent.synchronizer.stateLog   = new Logger('synchronizer', LogLevel.INFO);
        agent.synchronizer.storeLog   = new Logger('synchronizer', LogLevel.INFO);
        agent.synchronizer.opXferLog  = new Logger('synchronizer', LogLevel.INFO);

        agent.provider.controlLog     = new Logger('provider', LogLevel.INFO);
        agent.provider.opXferLog      = new Logger('provider', LogLevel.INFO);
        agent.provider.storeLog       = new Logger('provider', LogLevel.INFO);
        
        let gossip = pods[i].getAgent(StateGossipAgent.agentIdForGossip(peerNetworkId)) as StateGossipAgent;
        gossip.trackAgentState(agent.getAgentId());
        //agent;
        pods[i].registerAgent(agent);
    }


    let meshReady = false;

    let count = 0;

    while (!meshReady && count < 1000) {
        await new Promise(r => setTimeout(r, 100));
        const meshAgent = pods[size-1].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent
        meshReady = meshAgent.getPeers().length === (size-1);
        //console.log(count + '. peers: ' + meshAgent.getPeers().length);
        count = count + 1;
    }

    let replicated = false;

    if (meshReady) {
        count = 0;

        while (!replicated && count < 1500) {

            await new Promise(r => setTimeout(r, 100));

            const sr = await stores[size-1].load(s.hash()) as MutableSet<HashedLiteral> | undefined;

            if (sr !== undefined) {
                
                
                await sr.loadAllChanges();
                replicated = sr.size() === 1;
                //for (const elmt of sr.values()) {
                    //console.log('FOUND ELMT:');
                    //console.log(elmt);
                //}
            }

            count = count + 1;
        }
    }

    const scopy = await stores[size-1].load(s.hash()) as MutableSet<HashedLiteral>;

    await scopy.add(new HashedLiteral('remote change'))
    await s.add(new HashedLiteral('local change'));

    await stores[size-1].save(scopy);
    await stores[0].save(s);
    
    if (meshReady) {
        count = 0;

        while (!replicated && count < 1500) {

            await new Promise(r => setTimeout(r, 100));

            const sr = await stores[0].load(s.hash()) as MutableSet<HashedLiteral> | undefined;

            if (sr !== undefined) {
                
                
                await sr.loadAllChanges();
                replicated = sr.size() === 3;
                //for (const elmt of sr.values()) {
                    //console.log('FOUND ELMT:');
                    //console.log(elmt);
                //}
            }

            count = count + 1;
        }
    }
    
    await s.add(new HashedLiteral('further change'));
    await s.add(new HashedLiteral('another further change'));


    await stores[0].save(s);


    replicated = false;

    if (meshReady) {
        count = 0;

        while (!replicated && count < 1500) {

            await new Promise(r => setTimeout(r, 100));

            const sr = await stores[size-1].load(s.hash()) as MutableSet<Identity> | undefined;

            if (sr !== undefined) {
                
                
                await sr.loadAllChanges();
                replicated = sr.size() === 5;
                //console.log(Array.from(sr.values()));
                //for (const elmt of sr.values()) {
                    //console.log('FOUND ELMT:');
                    //console.log(elmt);
                //}
            }

            count = count + 1;
        }
    }



    //const meshAgent = pods[0].getAgent(PeerMeshAgent.agentIdForMesh(peerNetworkId)) as PeerMeshAgent
    //expect(meshAgent.getPeers().length).toEqual(size-1);

    for (const pod of pods) {
        pod.shutdown();
    }

    expect(meshReady).toBeTruthy();
    expect(replicated).toBeTruthy();

    done();
}