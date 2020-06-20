import { PeerSource } from './PeerSource';
import { PeeringAgent } from './PeeringAgent';

import { SecureNetworkAgent, SecureNetworkEventType, ConnectionIdentityAuthEvent, 
    IdentityLocation, IdentityAuthStatus, SecureMessageReceivedEvent } from '../network/SecureNetworkAgent';


import { Agent, AgentId } from '../../base/Agent';
import { NetworkAgent, Endpoint, ConnectionId, NetworkEventType, RemoteAddressListeningEvent, 
         ConnectionStatusChangeEvent, ConnectionStatus, MessageReceivedEvent } from '../network/NetworkAgent';

import { AgentPod, Event } from '../../base/AgentPod';
import { LinkupAddress } from 'net/linkup/LinkupAddress';

import { Hash } from 'data/model';
import { Identity } from 'data/identity';
import { Logger, LogLevel } from 'util/logging';

type Peer = { endpoint: Endpoint, identityHash: Hash, identity?: Identity };

type PeerConnection = {
    connId: ConnectionId;
    peer: Peer,
    status: PeerConnectionStatus,
    timestamp: number
};

enum PeerConnectionStatus {
    Connecting          = 'connecting',
    ReceivingConnection = 'receiving-connection',
    WaitingForOffer     = 'waiting-for-offer',
    OfferSent           = 'offer-sent',
    OfferAccepted       = 'offer-accepted',
    Ready               = 'ready'
};

// messages using during negotiation, before a connection has been secured:
// (i.e. both parties have proved they have the right identity for this peer group)

enum PeerMeshAgentMessageType  {
    PeeringOffer      = 'peering-offer',
    PeeringOfferReply = 'peering-offer-reply',
}

type PeeringOfferMessage = {
    type: PeerMeshAgentMessageType.PeeringOffer,
    content: { 
        meshId: string,
        localIdentityHash: Hash
    }
};

type PeeringOfferReplyMessage = {
    type: PeerMeshAgentMessageType.PeeringOfferReply,
    content: {
        meshId: string,
        accepted: boolean,
        localIdentityHash: Hash
    }
};

type PeerMeshAgentMessage = PeeringOfferMessage | PeeringOfferReplyMessage;


// secured connection: 

enum SecureMessageTypes {
    PeerMessage      = 'peer-message',
    ChooseConnection = 'choose-connection',
    ConfirmChosenConnection = 'confirm-chosen-connection'
}

type PeerMessage = { 
    type: SecureMessageTypes.PeerMessage,
    meshId: string,
    agentId: AgentId, 
    content: any
}


// Sometimes two peers may end up with more than one connection established between them,
// these messages are used to agree on a connection to use and safely close the others.
type ConnectionSelectionMessage = {
    type: SecureMessageTypes.ChooseConnection | SecureMessageTypes.ConfirmChosenConnection,
    meshId: string
}

type SecureMessage = PeerMessage | ConnectionSelectionMessage;


enum PeerMeshEventType {
    NewPeer = 'new-peer'
}

type NewPeerEvent = {
    type: PeerMeshEventType.NewPeer,
    content: {
        meshId: string,
        peer: Peer
    }
}

type Params = {
    minPeers: number,
    maxPeers: number,
    peerConnectionTimeout: number,
    peerConnectionAttemptInterval: number
    tickInterval: number
};

type Stats = {
    peers: number;
    connections: number;
}

class PeerMeshAgent implements Agent {

    static controlLog = new Logger(PeerMeshAgent.name, LogLevel.INFO);

    meshId: string;
    localPeer: Peer;

    peerSource: PeerSource;

    connections: Map<ConnectionId, PeerConnection>;
    connectionsPerEndpoint: Map<Endpoint, Array<ConnectionId>>;

    connectionAttemptTimestamps: Map<Endpoint, number>;
    onlineQueryTimestamps: Map<Endpoint, number>;
    chosenForDeduplication: Map<Endpoint, ConnectionId>;

    pod?: AgentPod;

    params: Params;

    tick: () => Promise<void>;
    tickTimerRef: any;

    controlLog = PeerMeshAgent.controlLog;

    constructor(meshId: string, localPeer: Peer, peerSource: PeerSource, params?: Partial<Params>) {
        this.meshId = meshId;
        this.localPeer = localPeer;
        
        this.peerSource = peerSource;

        this.connections = new Map();
        this.connectionsPerEndpoint = new Map();

        this.connectionAttemptTimestamps = new Map();
        this.onlineQueryTimestamps = new Map();
        this.chosenForDeduplication = new Map();

        if (params === undefined) {
            params = { };
        }

        this.params = {
            minPeers: params.minPeers || 6,
            maxPeers: params.maxPeers || 12,
            peerConnectionTimeout: params.peerConnectionTimeout || 20,
            peerConnectionAttemptInterval: params.peerConnectionAttemptInterval || 120,
            tickInterval: params.tickInterval || 10
        };

        this.tick = async () => {
            this.cleanUp();
            this.queryForOnlinePeers();
            if (false) { this.deduplicateConnections() };
        };
    }

    getAgentId(): string {
        return PeerMeshAgent.agentIdForMesh(this.meshId);
    }

    getTopic(): string {
        return this.meshId;
    }

    getLocalPeer(): Peer {
        return this.localPeer;
    }

    ready(pod: AgentPod): void {
        this.controlLog.debug('Started PeerControlAgent on ' + this.localPeer.endpoint + ' for id ' + this.localPeer.identityHash);
        this.pod = pod;
        this.init();
    }


    private async init() {

        const networkAgent = this.getNetworkAgent();

        networkAgent.listen(this.localPeer.endpoint);

        for(const ci of this.getNetworkAgent().getAllConnectionsInfo()) {
            if (ci.localEndpoint === this.localPeer.endpoint && 
                this.getNetworkAgent().checkConnection(ci.connId)) {

                let peer = await this.peerSource.getPeerForEndpoint(ci.remoteEndpoint);

                if (this.shouldConnectToPeer(peer)) {
                    this.getNetworkAgent().acceptConnection(ci.connId, this.getAgentId());
                    let pc = this.addPeerConnection(ci.connId, peer as Peer, PeerConnectionStatus.OfferSent);
                    
                    this.sendOffer(pc);
                }
            }
        }

        this.queryForOnlinePeers();
        this.tickTimerRef = window.setInterval(this.tick, this.params.tickInterval * 1000);

    }

    getPeers() : Array<Peer> {
        
        let seen = new Set<Endpoint>();
        let unique = new Array<Peer>();
        for (const pc of this.connections.values()) {
            if (pc.status === PeerConnectionStatus.Ready && !seen.has(pc.peer.endpoint)) {
                unique.push(pc.peer);
                seen.add(pc.peer.endpoint);
            }
        }

        return unique;
    }

    // Peer messaging functions, to be used by other local agents:

    sendToAllPeers(agentId: AgentId, content: any): number {
        let count=0;
        
        for (let ep of this.connectionsPerEndpoint.keys()) {
            if (this.sendToPeer(ep, agentId, content)) {
                count = count + 1;
            }
        }

        this.controlLog.trace(this.localPeer.endpoint + ' sending message to all (' + count + ') peers.');

        return count;
    }

    sendToPeer(ep: Endpoint, agentId: AgentId, content: any) {
        
        let connId = this.findWorkingConnectionId(ep);
        
        if (connId !== undefined) {

            let pc = this.connections.get(connId) as PeerConnection;

            let peerMsg: PeerMessage = {
                type: SecureMessageTypes.PeerMessage,
                meshId: this.meshId,
                agentId: agentId,
                content: content
            };

            let secureConnAgent = this.getSecureConnAgent();
            secureConnAgent.sendSecurely(
                connId, 
                this.localPeer.identityHash, 
                pc.peer.identityHash, 
                this.getAgentId(), 
                peerMsg
            );

            this.controlLog.trace(this.localPeer.endpoint + ' sending peer message to ' + ep);
            return true;
        } else {
            this.controlLog.trace(this.localPeer.endpoint + ' could not send peer message to ' + ep);
            return false;
        }
    }

    getStats() : Stats {
        let stats: Stats = {
            peers: 0,
            connections: this.connections.size
        };

        for (const ep of this.connectionsPerEndpoint.keys()) {
            if (this.findWorkingConnectionId(ep) !== undefined) {
                stats.peers += 1;
            }
        }

        return stats;
    }

    // Clean-up & new connection starting functions, called from the periodic tick

    private cleanUp() {


        let now = Date.now();

        // Remove connections that:
        //   1. are ready, but the connection has been lost
        //   2. are not ready, and the connection timeout has elapsed
        for (const pc of Array.from(this.connections.values())) {
            if (pc.status === PeerConnectionStatus.Ready) {
                if (!this.getNetworkAgent().checkConnection(pc.connId)) {
                    this.removePeerConnection(pc.connId);
                }
            } else {                
                if (now > pc.timestamp + this.params.peerConnectionTimeout * 1000) {
                        
                    this.removePeerConnection(pc.connId);
                }
            }
        }

        // Remove connection attempt timestamps that are too old to make a difference.
        // (i.e. peerConnectionAttemptInterval has already elapsed and we can try to reconnect)
        for (const [endpoint, timestamp] of Array.from(this.connectionAttemptTimestamps.entries())) {
            if (now > timestamp + 500 /*this.params.peerConnectionAttemptInterval * 1000*/) { // FIXME
                this.connectionAttemptTimestamps.delete(endpoint);
            }
        };

    }

    private async queryForOnlinePeers() {
        if (this.connectionsPerEndpoint.size < this.params.minPeers) {

            let candidates = await this.peerSource.getPeers(this.params.minPeers * 5);
            const endpoints = new Array<Endpoint>();
            const now = Date.now();

            this.controlLog.trace(() => ('Looking for peers, got ' + candidates.length + ' candidates'));

            for (const candidate of candidates) {

                if (this.localPeer.endpoint === candidate.endpoint) {
                    continue;
                }

                if (this.connectionsPerEndpoint.get(candidate.endpoint) !== undefined) {
                    continue;
                }

                const lastQueryTimestamp = this.onlineQueryTimestamps.get(candidate.endpoint);
                if (lastQueryTimestamp !== undefined &&
                    now < lastQueryTimestamp + this.params.peerConnectionAttemptInterval * 1000) {

                    continue;
                }

                const lastAttemptTimestamp = this.connectionAttemptTimestamps.get(candidate.endpoint);
                if (lastAttemptTimestamp !== undefined &&
                    now < lastAttemptTimestamp + this.params.peerConnectionAttemptInterval * 1000) {

                    continue
                }

                // we haven't queried nor attempted to connect to this endpoint recently, 
                // and we are not connected / connecting now, so query:
                endpoints.push(candidate.endpoint);

                if (endpoints.length >= this.params.minPeers - this.connectionsPerEndpoint.size) {
                    break;
                }
            }

            for (const endpoint of endpoints) {
                this.onlineQueryTimestamps.set(endpoint, now);
            }

            if (endpoints.length > 0) {
                this.controlLog.trace(() => ('Querying for online endpoints: '  + endpoints));

                this.getNetworkAgent().queryForListeningAddresses(
                                    LinkupAddress.fromURL(this.localPeer.endpoint), 
                                    endpoints.map((ep: Endpoint) => LinkupAddress.fromURL(ep)));
            }

            
        }
    }

    // Connection deduplication logic.

    private deduplicateConnections() {
        
        for (const [endpoint, connIds] of this.connectionsPerEndpoint.entries()) {

            if (connIds.length > 1) {

                

                // Check if there was a chosen connection.
                let chosenConnId = this.chosenForDeduplication.get(endpoint);
    
                // And in that case, if it is still working.
                if (chosenConnId !== undefined &&
                    this.getNetworkAgent().checkConnection(chosenConnId)) {
                        
                    chosenConnId = undefined;
                    this.chosenForDeduplication.delete(endpoint);
                    
                }

                
                if (chosenConnId === undefined) {

                    let ready = [];

                    for (const connId of connIds) {
                        let pc = this.connections.get(connId);
                        if (pc !== undefined && pc.status === PeerConnectionStatus.Ready && 
                            this.getNetworkAgent().checkConnection(connId)) {
                            
                            ready.push(connId);
                        }
                    }
    
                    
    
                    if (ready.length > 1) {
                        ready.sort();
                        chosenConnId = ready[0];
                        this.chosenForDeduplication.set(endpoint, chosenConnId);
                        this.sendChosenConnection(chosenConnId, endpoint);
                    }
                }

            }

            
        }

    }

    // Deduplication messages.

    private sendChosenConnection(chosenConnId: ConnectionId, endpoint:Endpoint) {

        this.sendConnectionSelectionMessage(chosenConnId, endpoint, SecureMessageTypes.ChooseConnection);
    }

    private sendChosenConnectionConfirmation(chosenConnId: ConnectionId, endpoint: Endpoint) {

        this.sendConnectionSelectionMessage(chosenConnId, endpoint, SecureMessageTypes.ConfirmChosenConnection);
    }

    private sendConnectionSelectionMessage(chosenConnId: ConnectionId, endpoint: Endpoint, type: (SecureMessageTypes.ChooseConnection | SecureMessageTypes.ConfirmChosenConnection)) {
        let connSelectionMsg: ConnectionSelectionMessage = {
            type: type,
            meshId: this.meshId,
        };

        let secureConnAgent = this.getSecureConnAgent();
        secureConnAgent.sendSecurely(
            chosenConnId, 
            this.localPeer.endpoint, 
            endpoint, 
            this.getAgentId(), 
            connSelectionMsg
        );
    }

    // Actual deduplication, when peers have agreed on which connection to keep.

    private chooseConnection(chosenConnId: ConnectionId) {

        let pc = this.connections.get(chosenConnId) as PeerConnection;

        let allConnIds = this.connectionsPerEndpoint.get(pc.peer.endpoint);

        if (allConnIds !== undefined) {
            for (const connId of allConnIds) {
                if (connId !== chosenConnId) {
                    this.getNetworkAgent().releaseConnection(connId, this.getAgentId());
                    this.removePeerConnection(connId);
                }
            }
        }
    }

    // Connection handling: find a working connecton to an ep, decide whether to connect to or accept a
    //                      connection from a potential peer.

    private findWorkingConnectionId(ep: Endpoint) : ConnectionId | undefined {
        let connIds = this.connectionsPerEndpoint.get(ep);

        if (connIds !== undefined) {

            for (let connId of connIds) {

                let pc = this.connections.get(connId);

                if (pc !== undefined && 
                    pc.status === PeerConnectionStatus.Ready && 
                    this.getNetworkAgent().checkConnection(connId)) {
                        return connId;
                }

            }

        } 
        
        return undefined; // no luck

    }


    // Returns a peer corresponding to ep if we should connect, undefined otherwse.
    private shouldConnectToPeer(p?: Peer) : boolean {

        if (p !== undefined &&                                           // - p is a peer
            this.connectionsPerEndpoint.size < this.params.minPeers &&   // - we're below minimum peers
            this.connectionsPerEndpoint.get(p.endpoint) === undefined && // - we're not connect[ed/ing] to ep
            this.localPeer.endpoint !== p.endpoint) {                    // - ep is not us
                                                                         // ====> then init conn. to ep

            const lastAttemptTimestamp = this.connectionAttemptTimestamps.get(p.endpoint);
            const now = Date.now();

            // check if we have to wait because we've attempted to connect to ep recently.
            if (lastAttemptTimestamp === undefined || 
                now > lastAttemptTimestamp + this.params.peerConnectionAttemptInterval * 1000) {
                
                // OK just do it.
                return true;
            }
        }

        // if conditions above are not met, don't connect.
        return false;
    }

    // Returns a peer corresponding to ep if we should accept the connection, undefined otherwise
    private async shouldAcceptPeerConnection(p?: Peer) {

        return (
            p !== undefined &&                                         // - p is actually a peer
            this.connectionsPerEndpoint.size < this.params.maxPeers && // - we're below maximum peers
            this.findWorkingConnectionId(p.endpoint) === undefined &&  // - there's not a working conn to ep
            this.localPeer.endpoint !== p.endpoint                     // - ep is not us
        );                                                             // ====> then accept conn. from ep

                                                                       
    }

    // Connection metadata: create / destroy a new PeerConnection

    private addPeerConnection(connId: ConnectionId, peer: Peer, status: PeerConnectionStatus) {

        if (this.connections.get(connId) !== undefined) {
            throw new Error('Trying to add connection ' + connId + ', but it already exists.');
        }

        let pc: PeerConnection = {
            connId: connId,
            peer: peer,
            status: status,
            timestamp: Date.now()
        };

        this.connections.set(connId, pc);
        let conns = this.connectionsPerEndpoint.get(peer.endpoint);
        if (conns === undefined) {
            conns = [];
            this.connectionsPerEndpoint.set(peer.endpoint, conns);
        }

        conns.unshift(connId);

        return pc;
    }

    private removePeerConnection(connId: ConnectionId) {
        let pc = this.connections.get(connId);

        if (pc !== undefined) {
            this.connections.delete(connId);

            let conns = this.connectionsPerEndpoint.get(pc.peer.endpoint);
            if (conns !== undefined) {
                let idx = conns.indexOf(connId);
                if (idx >= 0) {
                    conns.splice(idx, 1);
                }

                if (conns.length === 0) {
                    this.connectionsPerEndpoint.delete(pc.peer.endpoint);
                }
            }
            
        }
    }

    // Ask SecureConnectionAgent to secure a connection, given local and remote identities

    private secureConnection(pc: PeerConnection) {
        const secureConnAgent = this.getSecureConnAgent();

        secureConnAgent.secureForReceiving(pc.connId, this.localPeer.identity as Identity);
        secureConnAgent.secureForSending(pc.connId, pc.peer.identityHash, pc.peer.identity); 
    }
    
    private checkSecuredConnection(pc: PeerConnection) {

        const secureConnAgent = this.getSecureConnAgent();

        let localId  = secureConnAgent.getLocalVerifiedIdentity(pc.connId, this.localPeer.identityHash);
        let remoteId = secureConnAgent.getRemoteVerifiedIdentity(pc.connId, pc.peer.identityHash);

        let success = (localId !== undefined && remoteId !== undefined);

        pc.peer.identity = remoteId;

        return success;
    }
    

    // handling of events for peer connection negotiation:

    private async onOnlineEndpointDiscovery(ep: Endpoint) {

        this.controlLog.trace(() => (this.localPeer.endpoint + ' has discovered that ' + ep + ' is online.'));

        let peer = await this.peerSource.getPeerForEndpoint(ep);

        if (this.shouldConnectToPeer(peer)) {
            this.controlLog.trace(() => (this.localPeer.endpoint + ' will initiate peer connection to ' + ep + '.'));
            let connId = this.getNetworkAgent().connect(this.localPeer.endpoint, (peer as Peer).endpoint, this.getAgentId());
            this.addPeerConnection(connId, peer as Peer, PeerConnectionStatus.Connecting);
            this.connectionAttemptTimestamps.set(ep, Date.now());
        } else {
            this.controlLog.trace(() => (this.localPeer.endpoint + ' will NOT initiate peer connection to ' + ep + '.'));
        }
    }

    private async onConnectionRequest(connId: ConnectionId, local: Endpoint, remote: Endpoint) {
        
        if (this.localPeer.endpoint === local) {
            let peer = await this.peerSource.getPeerForEndpoint(remote);

            this.controlLog.trace(() => this.localPeer.endpoint + ' is receiving a conn. request from ' + remote + ', connId is ' + connId);

            if (this.shouldAcceptPeerConnection(peer)) {
                this.controlLog.trace('Will accept!');
                this.getNetworkAgent().acceptConnection(connId, this.getAgentId());
                this.addPeerConnection(connId, peer as Peer, PeerConnectionStatus.ReceivingConnection);
            }
        }

    }

    private onConnectionEstablishment(connId: ConnectionId, local: Endpoint, remote: Endpoint) {
        let pc = this.connections.get(connId);

        this.controlLog.trace(() => this.localPeer.endpoint + 'is receiving a connection from ' + remote + ' connId is ' + connId);

        if (pc !== undefined && this.localPeer.endpoint === local && pc.peer.endpoint === remote) {
            if (pc.status === PeerConnectionStatus.Connecting) {
                this.sendOffer(pc);
                pc.status = PeerConnectionStatus.OfferSent;
            } else if (pc.status === PeerConnectionStatus.ReceivingConnection) {
                pc.status = PeerConnectionStatus.WaitingForOffer;
            }
        } else {
            this.controlLog.trace('Unknown connection, ignoring. pc=' + pc + ' local=' + local + ' remote='+ remote);
        }
    }

    private async onReceivingOffer(connId: ConnectionId, source: Endpoint, destination: Endpoint, meshId: string, remoteIdentityHash: Hash) {
        
        this.controlLog.trace(() => (this.localPeer.endpoint + ' is receiving peering offer from ' + source));


        // do this here so we get atomicity below.
        let peer = await this.peerSource.getPeerForEndpoint(source);

        let reply  = false;
        let accept = false;
        let pc = this.connections.get(connId);
        
        // Maybe the PeerControlAgent, upong starting in another node, found an existint connection
        // to us, and wants to start a PeerConnection over it. So we have no previous state referring
        // to connection establishment, and we just receive the offer over an existing one.
        if (pc === undefined) {

            this.controlLog.trace('Found no previous state');

            if (this.shouldAcceptPeerConnection(peer)) {

                this.controlLog.trace('Will accept!');
                // Act as if we had just received the connection, process offer below.
                this.addPeerConnection(connId, peer as Peer, PeerConnectionStatus.WaitingForOffer);
                accept = true;
                reply  = true;

            } else {

                this.controlLog.trace('Will NOT accept!');
                if (peer !== undefined && 
                    peer.identityHash === remoteIdentityHash &&
                    this.meshId === meshId) {
                    
                    // OK, we don't want to accept, but this is, in principle, a valid peer.
                    // Send a rejection below.
                    accept = false;
                    reply  = true;
                }
            }
        } else { // pc !== undefined
                 // OK, we had previous state - if everything checks up, accept.

            this.controlLog.trace('Found previous state:' + pc.status);
            if (meshId === this.meshId &&
                pc.status === PeerConnectionStatus.WaitingForOffer &&
                source === pc.peer.endpoint &&
                destination === this.localPeer.endpoint &&
                remoteIdentityHash === pc.peer.identityHash) {
                
                this.controlLog.trace('Everything checks out!');
                reply  = true;
                accept = true;
            } else {
                this.controlLog.trace('The request is invalid.');
            }
        }

        // If the offer was correct, we send a reply.
        // Notice: accept implies reply.

        if (reply) {
            this.sendOfferReply(connId, accept);
        }

        // Act upon the offer: if it was accepted, update local state and 
        //                     initiate connection authentication. Otherwise
        //                     clear the state on this connection.

        if (accept) {
            const apc = pc as PeerConnection;
            
            if (!this.checkSecuredConnection(apc)) {
                apc.status = PeerConnectionStatus.OfferAccepted;
                this.secureConnection(apc);
            } else {
                apc.status = PeerConnectionStatus.Ready;
                this.broadcastNewPeerEvent(apc.peer);
            }
            
        } else {
            this.removePeerConnection(connId);
            this.getNetworkAgent().releaseConnectionIfExists(connId, this.getAgentId());
        }
    }

    private onReceivingOfferReply(connId: ConnectionId, source: Endpoint, destination: Endpoint, meshId: string, remoteIdentityHash: Hash, accepted: boolean) {
        let pc = this.connections.get(connId);

        this.controlLog.trace(this.localPeer.endpoint + ' is receiving offer reply from ' + source);

        if (pc !== undefined &&
            meshId === this.meshId &&
            pc.status === PeerConnectionStatus.OfferSent &&
            source === pc.peer.endpoint &&
            destination === this.localPeer.endpoint && 
            remoteIdentityHash === pc.peer.identityHash &&
            accepted) {
                if (!this.checkSecuredConnection(pc)) {
                    pc.status = PeerConnectionStatus.OfferAccepted;
                    this.secureConnection(pc);
                } else {
                    pc.status = PeerConnectionStatus.Ready;
                    this.broadcastNewPeerEvent(pc.peer);
                }
                
        }
    }

    private onConnectionAuthentication(connId: ConnectionId, identityHash: Hash, identity: Identity, identityLocation: IdentityLocation) {
        let pc = this.connections.get(connId);

        identityHash; identity; identityLocation;

        if (pc !== undefined && pc.status === PeerConnectionStatus.OfferAccepted) {
            if (this.checkSecuredConnection(pc)) {
                pc.status = PeerConnectionStatus.Ready;
                this.broadcastNewPeerEvent(pc.peer);
            }
        }
    }

    private onConnectionClose(connId: ConnectionId) {
        this.removePeerConnection(connId);
    }

    // Offer / offer reply message construction, sending.

    private sendOffer(pc: PeerConnection) {
        let message: PeeringOfferMessage = {
            type: PeerMeshAgentMessageType.PeeringOffer,
            content: {
                meshId: this.meshId,
                localIdentityHash: this.localPeer.identityHash
            }
        };

        this.controlLog.trace(() => (this.localPeer.endpoint + ' sending peering offer to ' + pc.peer.endpoint));

        this.getNetworkAgent().sendMessage(pc.connId, this.getAgentId(), message);
    }

    private sendOfferReply(connId: ConnectionId, accept: boolean) {
        let message: PeeringOfferReplyMessage = {
            type: PeerMeshAgentMessageType.PeeringOfferReply,
            content: {
                 meshId: this.meshId,
                 localIdentityHash: this.localPeer.identityHash,
                 accepted: accept
            }
        };

        this.controlLog.trace(() => (this.localPeer.endpoint + ' sending peering offer reply to ' + this.connections.get(connId)?.peer.endpoint) + ': ' + (accept? 'ACCEPT' : 'REJECT'));

        this.getNetworkAgent().sendMessage(connId, this.getAgentId(), message);
    }

    // handle of peer message reception

    private onPeerMessage(connId: ConnectionId, sender: Hash, recipient: Hash, meshId: string, agentId: AgentId, message: any) {
        let pc = this.connections.get(connId);

        if (meshId === this.meshId &&
            pc !== undefined && pc.status === PeerConnectionStatus.Ready &&
            pc.peer.identityHash === sender && this.localPeer.identityHash === recipient) {

            let agent = this.getLocalAgent(agentId);

            if (agent !== undefined && (agent as any).receivePeerMessage !== undefined) {
                let peeringAgent = agent as PeeringAgent;
                peeringAgent.receivePeerMessage(pc.peer.endpoint, sender, recipient, message);
            }
        }
    }

    // If two peers attempt to connect to each other nearly at the same time, they may end up with
    // two different connections between a single pair of endpoints. The following exchange allows
    // them to agree on a connection to use, and safely close the rest.

    
    private onConnectionSelection(connId: ConnectionId, sender: Hash, recipient: Hash, type: (SecureMessageTypes.ChooseConnection | SecureMessageTypes.ConfirmChosenConnection), meshId: string) {
        
        connId; sender; recipient; type; meshId;

        let pc = this.connections.get(connId);

        // If connId represents an acceptable option (a working connection in Ready state):
        if (pc !== undefined && 
            pc.status === PeerConnectionStatus.Ready &&
            this.getNetworkAgent().checkConnection(connId)) {

            let accept = false;

            let chosenConnId = this.chosenForDeduplication.get(pc.peer.endpoint);
            
            // if we didn't propose another connecitons, choose this one.
            if (chosenConnId === undefined || chosenConnId === connId) {
                accept = true;
            } else {
                const options = new Array<ConnectionId>();

                options.push(connId);
                options.push(chosenConnId);
                options.sort();

                const tieBreak = options[0];
                accept = tieBreak === connId;
            }

            if (accept) {
                this.chooseConnection(connId);
                if (type === SecureMessageTypes.ChooseConnection) {
                    this.sendChosenConnectionConfirmation(connId, pc.peer.endpoint);
                }  
            }
        }
        
    }



    /* The functions,receiveLocalEvent receives events generated by the other agents in the pod
     * and fires the appropriate event handlers defined above (onConnectionRequest, onReceivingOffer, 
     * etc.)
     */

    receiveLocalEvent(ev: Event): void {
        if (ev.type === NetworkEventType.RemoteAddressListening) {
            const listenEv = ev as RemoteAddressListeningEvent;
            
            this.onOnlineEndpointDiscovery(listenEv.content.remoteEndpoint);

        } else if (ev.type === NetworkEventType.ConnectionStatusChange) {
            const connEv = ev as ConnectionStatusChangeEvent;

            if (connEv.content.status === ConnectionStatus.Closed) {
                this.onConnectionClose(connEv.content.connId);
            } else if (connEv.content.status === ConnectionStatus.Received) {
                this.onConnectionRequest(connEv.content.connId, connEv.content.localEndpoint, connEv.content.remoteEndpoint);
            } else if (connEv.content.status === ConnectionStatus.Ready) {
                this.onConnectionEstablishment(connEv.content.connId, connEv.content.localEndpoint, connEv.content.remoteEndpoint);
            }
        } else if (ev.type === SecureNetworkEventType.ConnectionIdentityAuth) {
            let connAuth = ev as ConnectionIdentityAuthEvent;

            if (connAuth.content.status === IdentityAuthStatus.Accepted) {
                this.onConnectionAuthentication(connAuth.content.connId, connAuth.content.identityHash, connAuth.content.identity as Identity, connAuth.content.identityLocation);
            }
        } else if (ev.type === SecureNetworkEventType.SecureMessageReceived) {

            // The SecureConnectionAgent relies secure messages destined to this agent through local events.
            // Since this messages arrive through a secured connection, we know the sender is in possesion of
            // a given identity, and we know at which identity the message was directed (encrypted for).

            let secMsgEv = ev as SecureMessageReceivedEvent;
            let payload: SecureMessage = secMsgEv.content.payload;

            if (payload.type === SecureMessageTypes.PeerMessage) {
                this.onPeerMessage(secMsgEv.content.connId, secMsgEv.content.sender, secMsgEv.content.recipient, payload.meshId, payload.agentId, payload.content);
            } else if (payload.type === SecureMessageTypes.ChooseConnection || payload.type === SecureMessageTypes.ConfirmChosenConnection) {
                this.onConnectionSelection(secMsgEv.content.connId, secMsgEv.content.sender, secMsgEv.content.recipient, payload.type, payload.meshId);
            }
        } else if (ev.type === NetworkEventType.MessageReceived) {
            let msgEv = ev as MessageReceivedEvent;
            this.receiveMessage(msgEv.content.connectionId , msgEv.content.source, msgEv.content.destination, msgEv.content.content);
        }
    }

    receiveMessage(connId: ConnectionId, source: Endpoint, destination: Endpoint, content: any): void {
        
        let message = content as PeerMeshAgentMessage;

        if (message.type === PeerMeshAgentMessageType.PeeringOffer) {
            let offer = (content as PeeringOfferMessage).content;

            this.onReceivingOffer(connId, source, destination, offer.meshId, offer.localIdentityHash);
        } else if (message.type === PeerMeshAgentMessageType.PeeringOfferReply) {
            let offerReply = (content as PeeringOfferReplyMessage).content;

            this.onReceivingOfferReply(connId, source, destination, offerReply.meshId, offerReply.localIdentityHash, offerReply.accepted);
        }

    }

    // emitted events

    private broadcastNewPeerEvent(peer: Peer) {
        let ev: NewPeerEvent = {
            type: PeerMeshEventType.NewPeer,
            content: {
                meshId: this.meshId,
                peer: peer
            }
        };

        this.pod?.broadcastEvent(ev);
    }

    // shorthand functions

    private getNetworkAgent() {
        return this.pod?.getAgent(NetworkAgent.AgentId) as NetworkAgent;
    }

    private getLocalAgent(agentId: AgentId) {
        return this.pod?.getAgent(agentId) as Agent;
    }

    private getSecureConnAgent() {
        return this.getLocalAgent(SecureNetworkAgent.Id) as SecureNetworkAgent;
    }

    static agentIdForMesh(meshId: string) {
        return 'peer-control-for-' + meshId;
    }

}

export { PeerMeshAgent, Peer, PeerMeshEventType, NewPeerEvent };