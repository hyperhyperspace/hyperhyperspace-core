import { describeProxy } from 'config';
import { RNGImpl } from 'crypto/random';
import { CausalSet } from 'data/collections';
import { Identity, RSAKeyPair } from 'data/identity';
import { HashedObject } from 'data/model';
import { FeatureSet } from 'data/types/FeatureSet';
import { Features, MessageSet } from 'data/types/Messaging';
import { PermissionedFeatureSet } from 'data/types/PermissionedFeatureSet';
import { PermissionTest } from 'data/types/PermissionTest';
import { PeerGroupAgent } from 'mesh/agents/peer';
import { HeaderBasedSyncAgent, StateGossipAgent, TerminalOpsSyncAgent } from 'mesh/agents/state';
import { TestPeerGroupPods } from 'mesh/mock/TestPeerGroupPods';
import { Resources } from 'spaces/Resources';
import { IdbBackend, MemoryBackend } from 'storage/backends';
import { Store } from 'storage/store';
import { LogLevel } from 'util/logging';

HashedObject.validationLog.level = LogLevel.TRACE;

describeProxy('[UND] Undo support', () => {
    test( '[UND01] Basic undo w/ IndexedDB backend', async (done) => {

        let store = new Store(new IdbBackend('test-basic-undo'));
        
        await testBasicUndoCycle(store);

        //store.close();

        done();
    }, 30000);

    test( '[UND02] Basic undo w/ memory backend', async (done) => {

        let store = new Store(new MemoryBackend('test-basic-undo'));
        
        await testBasicUndoCycle(store);

        //store.close();

        done();
    }, 30000);

    test( '[UND03] Basic undo w/ IndexedDB backend over sync', async (done) => {

        let stores = [new Store(new IdbBackend('test-basic-undo-over-sync-1')),
                      new Store(new IdbBackend('test-basic-undo-over-sync-2'))];
        
        await testBasicUndoCycleWithSync(stores);

        /*for (const store of stores) {
            store.close();
        }*/

        done();
    }, 50000);

    test( '[UND04] Basic undo w/ memory backend over sync', async (done) => {

        let stores = [new Store(new MemoryBackend('test-basic-undo-over-sync-1')),
                      new Store(new MemoryBackend('test-basic-undo-over-sync-2'))];
        
        await testBasicUndoCycleWithSync(stores);

        /*for (const store of stores) {
            store.close();
        }*/

        done();
    }, 50000);

    test( '[UND05] Multi object undo cascade w/ IndexedDB backend', async (done) => {

        let store = new Store(new IdbBackend('test-basic-undo'));
        
        await testMultiObjectUndoCascade(store);

        //store.close();

        done();
    }, 30000);

    test( '[UND06] Multi object undo cascade  w/ memory backend', async (done) => {

        let store = new Store(new MemoryBackend('test-basic-undo'));
        
        //await testMultiObjectUndoCascade(store);

        store.close();

        done();
    }, 30000);

    test( '[UND07] Multi object undo cascade w/ IndexedDB backend over sync', async (done) => {

        let stores = [new Store(new IdbBackend('test-basic-undo-over-sync-1')),
                      new Store(new IdbBackend('test-basic-undo-over-sync-2'))];
        
        await testMultiObjectUndoCascadeWithSync(stores);

        /*for (const store of stores) {
            store.close();
        }*/

        done();
    }, 50000);

    test( '[UND08] Multi object undo cascade w/ memory backend over sync', async (done) => {

        let stores = [new Store(new MemoryBackend('test-basic-undo-over-sync-1')),
                      new Store(new MemoryBackend('test-basic-undo-over-sync-2'))];
        
        await testMultiObjectUndoCascadeWithSync(stores);

        /*for (const store of stores) {
            store.close();
        }*/

        done();
    }, 100000);

    test( '[UND09] CausalSet undo cascade w/ IndexedDB backend over sync', async (done) => {

        let stores = [new Store(new IdbBackend('causal-set-undo-over-sync-1')),
                      new Store(new IdbBackend('causal-set-undo-over-sync-2'))];
        
        await testMultiObjectUndoCascadeWithSyncUsingCausalSets(stores);

        /*for (const store of stores) {
            store.close();
        }*/

        done();
    }, 100000);

    test( '[UND10] CausalSet undo cascade w/ memory backend over sync', async (done) => {

        let stores = [new Store(new MemoryBackend('causal-set-undo-over-sync-1')),
                      new Store(new MemoryBackend('causal-set-undo-over-sync-2'))];
        
        await testMultiObjectUndoCascadeWithSyncUsingCausalSets(stores);

        /*for (const store of stores) {
            store.close();
        }*/

        done();
    }, 100000);
});

async function testBasicUndoCycle(store: Store) {

    const rootKeyPair = await RSAKeyPair.generate(1024);
    const rootId = Identity.fromKeyPair({role:'root'}, rootKeyPair);

    const adminKeyPair = await RSAKeyPair.generate(1024);
    const adminId = Identity.fromKeyPair({role:'admin'}, adminKeyPair);

    const userKeyPair = await RSAKeyPair.generate(1024);
    const userId = Identity.fromKeyPair({role:'user'}, userKeyPair);


    const temporaryUserKeyPair = await RSAKeyPair.generate(1024);
    const temporaryUserId = Identity.fromKeyPair({role:'user'}, temporaryUserKeyPair);
    await store.save(rootKeyPair);
    await store.save(rootId);

    await store.save(adminKeyPair);
    await store.save(adminId);

    await store.save(userKeyPair);
    await store.save(userId);

    const permissions = new PermissionTest();
    permissions.setAuthor(rootId);

    await permissions.addAdmin(adminId);
    await permissions.addUser(userId, adminId);
    await store.save(permissions);

    const permissionsClone = await store.load(permissions.hash()) as PermissionTest;
    await permissionsClone.loadAllChanges();

    await permissions.addUser(temporaryUserId, adminId);
    await store.save(permissions);

    permissions.watchForChanges();

    expect(permissions.isUser(userId)).toBeTruthy();
    expect(permissions.isUser(temporaryUserId)).toBeTruthy();

    expect(permissionsClone.isUser(userId)).toBeTruthy();
    expect(!permissionsClone.isUser(temporaryUserId)).toBeTruthy();

    await permissionsClone.removeAdmin(adminId);

    await store.save(permissionsClone);

    let i = 0;

    while (permissions.isUser(temporaryUserId) && i < 20) {
        await new Promise(r => setTimeout(r, 100));
    }

    expect(!permissions.isUser(temporaryUserId)).toBeTruthy();
    expect(permissions.isUser(userId)).toBeTruthy();

}

async function testBasicUndoCycleWithSync(stores: Store[]) {


    // create pods and add gossip agent

    const size = 2;
        
    let peerNetworkId = new RNGImpl().randomHexString(64);

    let pods = await TestPeerGroupPods.generate(peerNetworkId, size, size, size-1, 'wrtc', 'no-discovery');
    
    for (let i=0; i<size; i++) {
        const peerNetwork = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        let gossip = new StateGossipAgent(peerNetworkId, peerNetwork);
        
        pods[i].registerAgent(gossip);
    }

    // create identities and permissions objects

    const rootKeyPair = await RSAKeyPair.generate(1024);
    const rootId = Identity.fromKeyPair({role:'root'}, rootKeyPair);

    const adminKeyPair = await RSAKeyPair.generate(1024);
    const adminId = Identity.fromKeyPair({role:'admin'}, adminKeyPair);

    const userKeyPair = await RSAKeyPair.generate(1024);
    const userId = Identity.fromKeyPair({role:'user'}, userKeyPair);


    const temporaryUserKeyPair = await RSAKeyPair.generate(1024);
    const temporaryUserId = Identity.fromKeyPair({role:'user'}, temporaryUserKeyPair);

    const permissions = new PermissionTest();
    permissions.setAuthor(rootId);

    // set up sync in pods

    for (let i=0; i<size; i++) {
        TerminalOpsSyncAgent.toString
        const peerGroupAgent = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        
        //let agent = new TerminalOpsSyncAgent(peerGroupAgent, s.hash(), stores[i], MutableSet.opClasses);
        let agent = new HeaderBasedSyncAgent(peerGroupAgent, permissions.hash(), await Resources.create({store: stores[i]}), permissions.getAcceptedMutationOpClasses());
        let gossip = pods[i].getAgent(StateGossipAgent.agentIdForGossip(peerNetworkId)) as StateGossipAgent;
        gossip.trackAgentState(agent.getAgentId());
        //agent;
        pods[i].registerAgent(agent);
    }

    // add some permissions, persist to 'local' store
    
    const localStore = stores[0];
    const remoteStore = stores[1];

    await localStore.save(rootKeyPair);
    await localStore.save(rootId);

    await localStore.save(adminKeyPair);
    await localStore.save(adminId);

    await localStore.save(userKeyPair);
    await localStore.save(userId);


    await permissions.addAdmin(adminId);
    await permissions.addUser(userId, adminId);
    await localStore.save(permissions);
    

    expect(permissions.isUser(userId)).toBeTruthy();

    await remoteStore.save(rootKeyPair); // need this to perform root ops on the remote store

    // wait for permissions object to replicate to 'remote' store

    let i = 0;

    while (await remoteStore.load(permissions.hash()) === undefined && i < 200) {
        await new Promise(r => setTimeout(r, 100));
        i = i + 1;
    }

    // load a clone of the permissions object from the 'remote' store

    const permissionsClone = await remoteStore.load(permissions.hash()) as PermissionTest;
    await permissionsClone.loadAndWatchForChanges();

    // wait until the user permission for userId is replicated
    i = 0;

    while (!permissionsClone.isUser(userId) && i < 200) {
        await new Promise(r => setTimeout(r, 100));
        i = i + 1;
    }

    expect(permissionsClone.isUser(userId)).toBeTruthy();

    // revoke the user permission for admin in the remote

    await permissionsClone.removeAdmin(adminId);
    await remoteStore.save(permissionsClone);

    // add another user on the local store, where the admin revokation is not loaded yet

    await permissions.addUser(temporaryUserId, adminId);
    await localStore.save(permissions);

    expect(permissions.isUser(temporaryUserId)).toBeTruthy();

    permissions.loadAndWatchForChanges();
    
    i = 0;

    while (permissions.isUser(temporaryUserId) && i < 100) {
        await new Promise(r => setTimeout(r, 100));
        i = i + 1;
    }

    expect(!permissions.isUser(temporaryUserId)).toBeTruthy();
    expect(permissions.isUser(userId)).toBeTruthy();

    for (const pod of pods) {
        pod.shutdown();
    }
}

async function testMultiObjectUndoCascade(store: Store) {

    const rootKeyPair = await RSAKeyPair.generate(1024);
    const rootId = Identity.fromKeyPair({role:'root'}, rootKeyPair);

    const adminKeyPair = await RSAKeyPair.generate(1024);
    const adminId = Identity.fromKeyPair({role:'admin'}, adminKeyPair);

    await store.save(rootKeyPair);
    await store.save(rootId);

    await store.save(adminKeyPair);
    await store.save(adminId);

    const permissions = new PermissionTest();
    permissions.setAuthor(rootId);

    await permissions.addAdmin(adminId);
    await store.save(permissions);

    const permissionsClone = await store.load(permissions.hash()) as PermissionTest;
    await permissionsClone.loadAllChanges();

    permissions.watchForChanges();

    const features = new PermissionedFeatureSet(permissions);

    await store.save(features);

    features.watchForChanges();

    const useFeatureOpFail = features.useFeatureIfEnabled('anon-read', 'sample-usage-key');

    expect(useFeatureOpFail === undefined).toBeTruthy();

    await features.enableFeature('anon-write', adminId)

    const useFeatureOp = features.useFeatureIfEnabled('anon-write', 'sample-usage-key');

    expect(useFeatureOp !== undefined).toBeTruthy();

    const featuresClone = await store.load(features.hash()) as PermissionedFeatureSet;
    featuresClone.users = permissionsClone;

    expect(featuresClone.useFeatureIfEnabled('anon-write', 'another-usage-key') === undefined).toBeTruthy();

    await store.save(features);
    await featuresClone.loadAllChanges();

    expect(featuresClone.useFeatureIfEnabled('anon-write', 'yet-another-usage-key') !== undefined).toBeTruthy();

    await permissions.removeAdmin(adminId);
    
    await store.save(permissions);


    featuresClone.enableFeature('anon-read', adminId);

    await store.save(featuresClone);

    expect(featuresClone.isEnabled('anon-read')).toBeTruthy();

    
    await featuresClone.loadAllChanges();

    let i = 0;

    while (featuresClone.isEnabled('anon-read') && i < 100) {
        await new Promise(r => setTimeout(r, 100));
    }

    expect(!featuresClone.isEnabled('anon-read')).toBeTruthy();

    expect(featuresClone.isEnabled('anon-write' )).toBeTruthy();

}

async function testMultiObjectUndoCascadeWithSync(stores: Store[]) {


    // create pods and add gossip agent

    const size = 2;
        
    let peerNetworkId = new RNGImpl().randomHexString(64);

    let pods = await TestPeerGroupPods.generate(peerNetworkId, size, size, size-1, 'wrtc', 'no-discovery');
    
    for (let i=0; i<size; i++) {
        const peerNetwork = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        let gossip = new StateGossipAgent(peerNetworkId, peerNetwork);
        
        pods[i].registerAgent(gossip);
    }

    const localStore = stores[0];
    const remoteStore = stores[1];

    const rootKeyPair = await RSAKeyPair.generate(1024);
    const rootId = Identity.fromKeyPair({role:'root'}, rootKeyPair);

    const adminKeyPair = await RSAKeyPair.generate(1024);
    const adminId = Identity.fromKeyPair({role:'admin'}, adminKeyPair);

    await localStore.save(rootKeyPair);
    await localStore.save(rootId);

    await localStore.save(adminKeyPair);
    await localStore.save(adminId);

    const permissions = new PermissionTest();
    permissions.setAuthor(rootId);

    await permissions.addAdmin(adminId);
    await localStore.save(permissions);

    // for setting features later
    await remoteStore.save(adminKeyPair);

    permissions.watchForChanges();

    const features = new PermissionedFeatureSet(permissions);

    await localStore.save(features);

    await features.enableFeature('anon-write', adminId)

    await localStore.save(features);

    features.watchForChanges();

    // set up sync in pods

    for (let i=0; i<size; i++) {
        TerminalOpsSyncAgent.toString
        const peerGroupAgent = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        
        //let agent = new TerminalOpsSyncAgent(peerGroupAgent, s.hash(), stores[i], MutableSet.opClasses);
        let agent = new HeaderBasedSyncAgent(peerGroupAgent, features.hash(),  await Resources.create({store: stores[i]}), features.getAcceptedMutationOpClasses());
        let gossip = pods[i].getAgent(StateGossipAgent.agentIdForGossip(peerNetworkId)) as StateGossipAgent;
        gossip.trackAgentState(agent.getAgentId());
        //agent;
        pods[i].registerAgent(agent);
    }


    let permissionsClone: PermissionTest|undefined = undefined;
    
    let i = 0;
    while (i<200 && permissionsClone === undefined) {
        permissionsClone = await remoteStore.load(permissions.hash()) as PermissionTest|undefined;
        await new Promise(r => setTimeout(r, 100));
        i = i + 1;
    }
    
    expect(permissionsClone !== undefined).toBeTruthy();

    await permissionsClone?.loadAllChanges();

    
    let featuresClone: PermissionedFeatureSet|undefined = undefined;
    
    i = 0;
    while (i<100 && featuresClone === undefined) {
        featuresClone  = await remoteStore.load(features.hash(), false) as PermissionedFeatureSet|undefined;
        await new Promise(r => setTimeout(r, 50));
        i = i + 1;
    }
    
    (featuresClone as PermissionedFeatureSet).users = permissionsClone;

    expect(featuresClone?.useFeatureIfEnabled('anon-write', 'another-usage-key') === undefined).toBeTruthy();

    await localStore.save(features);
    
    i = 0;
    while (i < 100 && featuresClone?.useFeatureIfEnabled('anon-write', 'yet-another-usage-key') === undefined) {
        await featuresClone?.loadAllChanges();
        await new Promise(r => setTimeout(r, 50));
        i = i + 1;
    }
    
    await permissions.removeAdmin(adminId);
    await localStore.save(permissions);

    expect(featuresClone?.useFeatureIfEnabled('anon-write', 'yet-another-usage-key') !== undefined).toBeTruthy();

    await featuresClone?.enableFeature('anon-read', adminId);

    await localStore.save(featuresClone as PermissionedFeatureSet);

    expect(featuresClone?.isEnabled('anon-read') === true).toBeTruthy();



    i = 0;
    while (i < 100 && featuresClone?.isEnabled('anon-read')) {
        await featuresClone.loadAllChanges();
        await new Promise(r => setTimeout(r, 50));
        i = i + 1;
    }

    expect(featuresClone?.isEnabled('anon-read') === false).toBeTruthy();
    expect(featuresClone?.isEnabled('anon-write' )).toBeTruthy();




    for (const pod of pods) {
        pod.shutdown();
    }
}

async function testMultiObjectUndoCascadeWithSyncUsingCausalSets(stores: Store[]) {


    // create pods and add gossip agent

    const size = 2;
        
    let peerNetworkId = new RNGImpl().randomHexString(64);

    let pods = await TestPeerGroupPods.generate(peerNetworkId, size, size, size-1, 'wrtc', 'no-discovery');
    
    for (let i=0; i<size; i++) {
        const peerNetwork = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        let gossip = new StateGossipAgent(peerNetworkId, peerNetwork);
        
        pods[i].registerAgent(gossip);
    }

    const localStore = stores[0];
    const remoteStore = stores[1];

    const rootKeyPair = await RSAKeyPair.generate(1024);
    const rootId = Identity.fromKeyPair({role:'root'}, rootKeyPair);

    const adminKeyPair = await RSAKeyPair.generate(1024);
    const adminId = Identity.fromKeyPair({role:'admin'}, adminKeyPair);

    await localStore.save(rootKeyPair);
    await localStore.save(rootId);

    await localStore.save(adminKeyPair);
    await localStore.save(adminId);

    const messages = new MessageSet(rootId);


    await messages.config?.authorized?.add(adminId);
    await localStore.save(messages);
    await localStore.save(messages.config?.authorized as CausalSet<Identity>);

    // for setting features later
    await remoteStore.save(adminKeyPair);

    messages.config?.authorized?.watchForChanges();

    await localStore.save(messages);

    await messages.config?.enable(Features.OpenPost, adminId);

    await localStore.save(messages.config as FeatureSet);


    messages.config?.watchForChanges();

    // set up sync in pods

    LogLevel.TRACE
    HashedObject.validationLog.level = LogLevel.TRACE;
    //HeaderBasedSyncAgent.controlLog.level = LogLevel.TRACE;

    for (let i=0; i<size; i++) {
        TerminalOpsSyncAgent.toString
        const peerGroupAgent = pods[i].getAgent(PeerGroupAgent.agentIdForPeerGroup(peerNetworkId)) as PeerGroupAgent;
        
        //let agent = new TerminalOpsSyncAgent(peerGroupAgent, s.hash(), stores[i], MutableSet.opClasses);
        let messagesAgent = new HeaderBasedSyncAgent(peerGroupAgent, messages.hash(),  await Resources.create({store: stores[i]}), messages.getAcceptedMutationOpClasses());
        let configAgent = new HeaderBasedSyncAgent(peerGroupAgent, messages.getConfig().hash(),  await Resources.create({store: stores[i]}), messages.getConfig().getAcceptedMutationOpClasses());
        let authAgent = new HeaderBasedSyncAgent(peerGroupAgent, messages.getConfig().getAuthorizedIdentitiesSet().hash(),  await Resources.create({store: stores[i]}), messages.getConfig().getAuthorizedIdentitiesSet().getAcceptedMutationOpClasses());

        let gossip = pods[i].getAgent(StateGossipAgent.agentIdForGossip(peerNetworkId)) as StateGossipAgent;
        gossip.trackAgentState(messagesAgent.getAgentId());
        gossip.trackAgentState(configAgent.getAgentId())
        gossip.trackAgentState(authAgent.getAgentId())
        //agent;
        pods[i].registerAgent(messagesAgent);
        pods[i].registerAgent(configAgent);
        pods[i].registerAgent(authAgent);
    }


    let messagesClone: MessageSet = messages.clone();
    await remoteStore.save(messagesClone);

    expect( !messagesClone?.config?.isEnabled(Features.OpenPost)).toBeTruthy();

    let i = 0;
    while (i < 100 && !messages?.config?.isEnabled(Features.OpenPost)) {
        await messages?.config?.loadAllChanges();
        await new Promise(r => setTimeout(r, 100));
        i = i + 1;
    }
    

    expect(messages?.config?.isEnabled(Features.OpenPost)).toBeTruthy();

    let enabled = false;

    //console.log(messages?.config);

    i = 0;
    while (i < 200 && !enabled) {
        await messagesClone?.config?.loadAllChanges();
        await messagesClone?.config?.authorized?.loadAllChanges();
        enabled = await messagesClone?.config?.enable(Features.AnonRead, adminId) as boolean;
        //console.log(enabled);
        //console.log(messagesClone?.config)
        await new Promise(r => setTimeout(r, 100));
        i = i + 1;
    }

    expect(enabled).toBeTruthy();
    expect(messagesClone?.config?.isEnabled(Features.AnonRead)).toBeTruthy();

    
    await messages.config?.authorized?.delete(adminId);



    await localStore.save(messages.config?.authorized as CausalSet<Identity>);

    await remoteStore.save(messagesClone as MessageSet);
    await remoteStore.save(messagesClone?.config as FeatureSet);
    await remoteStore.save(messagesClone?.config?.authorized as CausalSet<Identity>);

    //console.log('local')
    //console.log(messages?.config?.authorized)

    i = 0;
    while (i < 100 && messagesClone?.config?.isEnabled(Features.AnonRead)) {
        await messagesClone?.config?.loadAllChanges();
        //console.log(messagesClone?.config?.has(Features.AnonRead))
        //console.log(messagesClone?.config)
        await new Promise(r => setTimeout(r, 100));
        i = i + 1;
    }

    //console.log('remote')
    //console.log(messagesClone?.config?.authorized)
    

    /*let i = 0;

    while (featuresClone.isEnabled('anon-read') && i < 100) {
        await new Promise(r => setTimeout(r, 100));
    }*/

    await messagesClone?.config?.authorized?.loadAllChanges();
    /*
    console.log('auth term')
    console.log(messagesClone?.config?.authorized?._terminalOps);
    console.log('current per elmt')
    console.log(messagesClone?.config?._currentAddOpsPerElmt.get(HashedObject.hashElement(Features.AnonRead)));
    console.log('config term')
    console.log(messagesClone?.config?._terminalOps);

    for (const op of (messagesClone?.config?._terminalOps as Map<string, MutationOp>).values()) {
        console.log(op.getCausalOps().values().next().value);
    }

    console.log('config all')
    console.log(messagesClone?.config?._allAppliedOps);
*/    
    expect(!messagesClone?.config?.authorized?.has(adminId)).toBeTruthy();
    expect(!messagesClone?.config?.isEnabled(Features.AnonRead)).toBeTruthy();
    expect(messagesClone?.config?.isEnabled(Features.OpenPost)).toBeTruthy();

    for (const pod of pods) {
        pod.shutdown();
    }
}

export { testBasicUndoCycle, testBasicUndoCycleWithSync };