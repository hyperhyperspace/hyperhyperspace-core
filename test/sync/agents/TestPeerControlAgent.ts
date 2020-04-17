

// a naive peer control agent

import { Agent, Swarm, Event, EventType, CallId, Message, PeerMessage, Endpoint } from "sync/swarm";
import { LinkupAddress } from 'sync/linkup';
import { TestPeer } from './TestPeer';


const LINKUP_SERVER = 'ws://localhost:3002';

class TestPeerControlAgent implements Agent {

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
        return 'test-peer-control';
    }

    ready(swarm: Swarm): void {
        this.swarm = swarm;
        swarm.init(this.localAddress, this.localPeer);

        for (const remoteId of this.remoteIds) {
            swarm.queryForListeningAddresses([new LinkupAddress(LINKUP_SERVER, remoteId)]);
        }

    }

    receiveLocalEvent(ev: Event): void {
        
        if (ev.type === EventType.RemoteAddressListening) {
            this.swarm?.connect(ev.content as Endpoint);
        }

        if (ev.type === EventType.LocalConnectionReady) {
            const endpoint = this.swarm?.getConnectionEndpoint(ev.content as CallId);

            if (endpoint !== undefined) {
                let address = LinkupAddress.fromURL(endpoint);

                let peerIdx = this.remoteIds.indexOf(address.linkupId);

                if (peerIdx >= 0) {
                    let peer = new TestPeer(address.linkupId, endpoint, ev.content as CallId);
                    this.swarm?.registerPeer(peer);
                }
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