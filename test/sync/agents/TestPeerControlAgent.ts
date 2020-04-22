

// a naive peer control agent

import { Agent, Swarm, Event, EventType, CallId, Message, PeerMessage, Endpoint } from "sync/swarm";
import { LinkupAddress } from 'sync/linkup';
import { TestPeer } from '../swarm/TestPeer';


const LINKUP_SERVER = 'ws://localhost:3002';

class TestPeerControlAgent implements Agent {

    static Id = 'test-peer-control';

    localId: string;

    localAddress: LinkupAddress;

    remoteIds: Array<string>;


    localPeer: TestPeer;

    


    swarm?: Swarm;



    constructor(localId: string, remoteIds: Array<string>) {

        this.localId = localId;
        this.localAddress = new LinkupAddress(LINKUP_SERVER, localId);

        this.localPeer = new TestPeer(this.localId, this.localAddress.url());

        this.remoteIds = remoteIds;
    }




    getId(): string {
        return TestPeerControlAgent.Id;
    }

    ready(swarm: Swarm): void {
        this.swarm = swarm;
        swarm.init(this.localAddress, this.localPeer);

        let remotes:LinkupAddress[] = [];
        for (const remoteId of this.remoteIds) {
            remotes.push(new LinkupAddress(LINKUP_SERVER, remoteId))
        }

        swarm.queryForListeningAddresses(remotes);
    }

    receiveLocalEvent(ev: Event): void {
        
        if (ev.type === EventType.RemoteAddressListening) {

            let endpoint = ev.content as Endpoint;

            if (this.swarm?.getCallIdForEndpoint(endpoint) === undefined) {
                this.swarm?.connect(endpoint); 
            }

            
        }

        if (ev.type === EventType.LocalConnectionReady) {
            const endpoint = this.swarm?.getConnectionEndpoint(ev.content as CallId);

            if (endpoint !== undefined) {
                let address = LinkupAddress.fromURL(endpoint);

                //let peerIdx = this.remoteIds.indexOf(address.linkupId);

                //if (peerIdx >= 0) {
                    let peer = new TestPeer(address.linkupId, endpoint, ev.content as CallId);
                    peer;
                    this.swarm?.registerConnectedPeer(peer);
                //}
            }

        }
    
    }

    receiveMessage(_message: Message): void {
        throw new Error("Method not implemented.");
    }

    receivePeerMessage(_message: PeerMessage): void {
        throw new Error("Method not implemented.");
    }

    


}

export { TestPeerControlAgent };