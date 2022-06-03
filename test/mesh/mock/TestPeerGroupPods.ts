import { TestPeerSource } from './TestPeerSource';

import { AgentPod, MeshProxy } from 'mesh/service';

import { PeerInfo, PeerGroupAgent, SecretBasedPeerSource } from 'mesh/agents/peer';
import { ObjectDiscoveryPeerSource } from 'mesh/agents/peer';

import { PeerSource } from 'mesh/agents/peer';

import { RNGImpl } from 'crypto/random';
import { Identity, RSAKeyPair } from 'data/identity';
import { LinkupAddress, LinkupManager } from 'net/linkup';
import { HashedLiteral } from 'data/model';
import { Mesh } from 'mesh/service';
import { RemotingMesh } from './RemotingMesh';

class TestPeerGroupPods {
    
    static async generate(peerGroupId: string, activePeers: number, totalPeers: number, peerConnCount: number, network: 'wrtc'|'ws'|'mix' = 'wrtc', discovery:'linkup-discovery'|'linkup-discovery-secret'|'no-discovery', basePort?: number, useRemoting=false): Promise<Array<AgentPod>> {

        let secret: string|undefined = undefined;

        if (discovery === 'linkup-discovery-secret') {
            secret = new RNGImpl().randomHexString(256);
        }

        let peers = new Array<PeerInfo>();

        for (let i=0; i<totalPeers; i++) {
            let id = Identity.fromKeyPair({'id':'peer' + i}, await RSAKeyPair.generate(1024));
            
            let host = LinkupManager.defaultLinkupServer;

            if (network === 'ws' || (network === 'mix' && i < totalPeers / 2)) {
                host = 'ws://localhost:' + (basePort as number + i);
            }

            let peer: PeerInfo = {
                endpoint: host  + '/' + new RNGImpl().randomHexString(128),
                identity: id,
                identityHash: id.hash()
            };

            peers.push(peer);
        }

        let peerSource: PeerSource = new TestPeerSource(peers);

        if (discovery === 'linkup-discovery-secret') {
            peers = peers.map((p: PeerInfo) => { let x = new Object(); Object.assign(x, p); return x as PeerInfo;});
            for (const peer of peers) {
                peer.endpoint = SecretBasedPeerSource.encryptEndpoint(peer.endpoint, secret as string);   
            }
                         
        }

        let pods = new Array<AgentPod>();

        for (let i=0; i<activePeers; i++) {

            let remoting: RemotingMesh | undefined;
            let meshClient: Mesh | MeshProxy;
            let mesh: Mesh;
            

            if (useRemoting) {
                remoting = new RemotingMesh();
                meshClient = remoting.client;
                mesh = remoting.mesh;
            } else {
                remoting = undefined;
                meshClient = new Mesh();
                mesh = meshClient;
            }

            let pod: AgentPod = mesh.pod;

            let peerSourceToUse: PeerSource = peerSource;

            let params: any = { maxPeers: peerConnCount, minPeers: peerConnCount, tickInterval: 1.5, peerConnectionAttemptInterval: 15, peerConnectionTimeout: 14 };

            if (discovery === 'linkup-discovery' || discovery === 'linkup-discovery-secret') {

                params.tickInterval = 1; // speed up peer group management to make up for peer discovery

                let object = new HashedLiteral(peerGroupId);


                meshClient.startObjectBroadcast(object, [LinkupManager.defaultLinkupServer], [peers[i].endpoint]);

                //peerSourceToUse = new ObjectDiscoveryPeerSource(mesh, object, [LinkupManager.defaultLinkupServer], peers[i].endpoint, async (ep: string) => SecretBasedPeerSource.unmaskPeer(await peerSource.getPeerForEndpoint(ep), secret as string));
                
                if (discovery === 'linkup-discovery-secret') {
                    //const secretPeerSource = new SecretBasedPeerSource(peerSource, secret as string);
                    peerSourceToUse = new ObjectDiscoveryPeerSource(mesh, object, [LinkupManager.defaultLinkupServer], LinkupAddress.fromURL(peers[i].endpoint, peers[i].identity), SecretBasedPeerSource.makeSecureEndpointParser((ep: string) => peerSource.getPeerForEndpoint(ep), secret as string) /*(ep: string) => secretPeerSource.getPeerForEndpoint(ep)*/);
                } else {
                    peerSourceToUse = new ObjectDiscoveryPeerSource(mesh, object, [LinkupManager.defaultLinkupServer], LinkupAddress.fromURL(peers[i].endpoint, peers[i].identity), (ep: string) => peerSource.getPeerForEndpoint(ep));
                }

                

            

            }

            let peerGroupAgent = new PeerGroupAgent(peerGroupId, peers[i], peerSourceToUse, params);
            pod.registerAgent(peerGroupAgent);
            pods.push(pod);
        }

        return pods;

    }

}

export { TestPeerGroupPods };