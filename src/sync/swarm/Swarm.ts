import { WebRTCConnection } from '../transport/WebRTCConnection';
import { Hash, HashedSet } from 'data/model';
import { Agent, AgentId } from './Agent';
import { Peer, PeerId } from './Peer';
import { LinkupManager } from 'sync/linkup/LinkupManager';
import { LinkupAddress } from 'sync/linkup/LinkupAddress';
import { RNGImpl } from 'crypto/random';
import { Logger, LogLevel } from 'util/logging';

type Endpoint = string;

type CallId  = string;

type Event = { type: EventType, content: any};

const BITS_FOR_CALL_ID = 128;

enum EventType {
    LocalAgentAddition = 'local-agent-addition',
    LocalAgentRemoval  = 'local-agent-removal',
    LocalPeerAddition  = 'local-peer-addition',
    LocalPeerRemoval   = 'local-peer-removal',
    LocalConnectionReady  = 'local-connection-ready',
    LocalConnectionClosed = 'local-connection-closed',

    RemoteAddressListening = 'remote-address-listening',

    RemoteAgentAdditions = 'remote-agent-additions',
    RemoteAgentRemovals  = 'remote-agent-removals'
};

type ControlMessage = { source: PeerId, destination: PeerId, type: ControlMessageType, content?: any};

enum ControlMessageType {

    RequestAgentSetHash = 'request-agent-set-signature',
    SendAgentSetHash    = 'send-agent-set-signature',
    
    RequestAgentSet = 'request-agent-set',
    SendAgentSet    = 'send-agent-set',

    NotifyAgentSetChange = 'notify-agent-set-change',

    SendMessageToAgent   = 'send-message-to-agent'
}

type PeerMessage = { sourceId: PeerId, destinationId: PeerId, agentId: AgentId, content: any };
type Message     = { callId: CallId, source: Endpoint, destination: Endpoint, agentId: AgentId, content: any }

type ConnectionInfo = { 
    remoteEndpoint: Endpoint, 
    callId : CallId, 
    status: ConnectionStatus,
    timestamp: number,
    peerId?: PeerId
}

enum ConnectionStatus {
    Establishment   = 'establishment',
    PeerValidation  = 'peer-validation',
    PeerReady       = 'peer-ready'
}


// all the following in seconds

const HouseKeepingInterval = 5;

const ConnectionEstablishmentTimeout = 10;
const PeerValidationTimeout = 20;

class Swarm {

    static logger = new Logger(Swarm.name, LogLevel.INFO);

    topic      : string;

    localAddress?  : LinkupAddress;
    localEndpoint? : Endpoint;
    localPeer?     : Peer;
    
    linkupManager : LinkupManager;

    connections : Map<CallId, WebRTCConnection>;
    agents      : Map<string, Agent>;
    peers       : Map<PeerId, Peer>;

    localAgentSet    : HashedSet<AgentId>;
    remoteAgentSets  : Map<Hash, HashedSet<AgentId>>;

    connectionInfo : Map<CallId, ConnectionInfo>;
    
    messageCallback : (data: any, conn: WebRTCConnection) => void;

    connectionReadyCallback : (conn: WebRTCConnection) => void;

    newConnectionRequestCallback : (sender: LinkupAddress, callId: string, message: any) => void;

    doHousekeeping : () => void;

    intervalRef : any;

    constructor(topic: string, linkupManager = new LinkupManager()) {

        this.topic    = topic;

        this.linkupManager = linkupManager;

        this.connections = new Map();
        this.agents      = new Map();
        this.peers       = new Map();

        this.localAgentSet = new HashedSet();
        this.remoteAgentSets = new Map();

        this.connectionInfo = new Map(); 

        this.messageCallback = (data: any, conn: WebRTCConnection) => {

            Swarm.logger.trace('Peer ' + this.localPeer?.getId() + ' received message: ' + data);

            const callId = conn.getCallId(); 
            const connInfo = this.connectionInfo.get(callId);

            const message = JSON.parse(data);

            if (connInfo !== undefined) {
                const status = connInfo.status;

                
                if (message.callId !== undefined) {
                    
                    // plain message, not peer to peer yet.
                    const msg = message as Message;

                    if (msg.callId === conn.getCallId()) {
                        this.receiveMessage(msg);
                    }
                } else if (status === ConnectionStatus.PeerReady) {

                    // if callId is absent, then only proceed if this connection
                    // has completed peer to peer validation.

                    const peerId = connInfo.peerId as PeerId;
                    const msg    = message as ControlMessage;

                    if (peerId === msg.source && this.localPeer?.getId() === msg.destination) {
                        
                        this.receiveControlMessage(msg);
                        
                    }
                }
            }
        };

        this.connectionReadyCallback = (conn: WebRTCConnection) => {
            const callId = conn.getCallId();
            const connInfo = this.connectionInfo.get(callId);
            if (connInfo === undefined) {
                conn.close();
            } else {
                this.connections.set(callId, conn);
                connInfo.status = ConnectionStatus.PeerValidation;
                this.sendLocalEvent({type: EventType.LocalConnectionReady, content: callId});
            }
        }

        this.newConnectionRequestCallback = (sender: LinkupAddress, callId: string, message: any) => {

            let conn = this.connections.get(callId);
            let connInfo = this.connectionInfo.get(callId);

            if (connInfo === undefined || connInfo.status === ConnectionStatus.Establishment) {
                connInfo = {
                    remoteEndpoint: sender.url(), 
                    callId: callId, 
                    status: ConnectionStatus.Establishment,
                    timestamp: Date.now()
                };
                this.connectionInfo.set(callId, connInfo);
                if (conn === undefined) {
                    conn = new WebRTCConnection(linkupManager, this.localAddress as LinkupAddress, sender, callId, this.connectionReadyCallback);
                }
                conn.setMessageCallback(this.messageCallback);
                conn.answer(message);
            } else {
                // ignore this message
            }            
        };

        this.doHousekeeping = () => {

            let toCleanUp = new Array<CallId>();

            // check connection health / startup timeouts
            // check agent set request timeout if connection is healthy

            for (const conn of this.connections.values()) {
                let callId = conn.getCallId();

                let info = this.connectionInfo.get(callId) as ConnectionInfo;

                if (info.status === ConnectionStatus.Establishment) {
                    if (Date.now() > info.timestamp + (1000 * ConnectionEstablishmentTimeout)) {
                        toCleanUp.push(callId);
                    } 
                } else {
                    if (!conn.channelIsOperational()) {
                        toCleanUp.push(callId);
                    } else {
                        if (info.status === ConnectionStatus.PeerValidation) {
                            if (Date.now() > info.timestamp + (1000 * PeerValidationTimeout)) {
                                toCleanUp.push(callId);
                            }
                        } else if (info.status === ConnectionStatus.PeerReady) {
                            if (Math.random() > 0.05) {
                                this.requestAgentSetHash(info.peerId as PeerId);
                            }
                        }
                    }
                }

            }
        };

    }

    // Swarm init, start, stop, shutdown

    init(address: LinkupAddress, peer: Peer) {

        this.localAddress = address;
        this.localEndpoint = address.url();
        this.localPeer = peer;

        this.linkupManager.listenForQueryResponses(this.localAddress.linkupId, (linkupId: string, addresses: Array<LinkupAddress>) => {

            if (linkupId === this.localAddress?.linkupId) {
                for (const address of addresses) {
                    this.sendLocalEvent({type: EventType.RemoteAddressListening, content: address.url()});
                }
            }

        });

        Swarm.logger.debug('Initialized swarm ' + this.topic + ' for peer ' + this.localPeer.getId());
        this.start();
    }

    start() {
        
        this.linkupManager.listenForMessagesNewCall(this.localAddress as LinkupAddress, this.newConnectionRequestCallback);
        this.intervalRef = window.setInterval(this.doHousekeeping, HouseKeepingInterval * 1000);
    }

    stop() {
        // TODO: add 'unlisten' to LinkupManager

        if (this.intervalRef !== undefined) {
            window.clearInterval(this.intervalRef);
            this.intervalRef = undefined;
        }    
    }

    shutdown() {
        this.linkupManager.shutdown();
        this.stop();
        for (const conn of this.connections.values()) {
            this.connectionInfo.delete(conn.getCallId());
            this.connections.delete(conn.getCallId());
            conn.close();
        }
    }

    // Connection management: connect-disconnect, find out which addresses are online
    //                        at the moment, recover the endpoint for a current callId.

    connect(endpoint: Endpoint) {


        /*
        let est = 0;
        let val = 0;
        let ok  = 0;

        for (const info of this.connectionInfo.values()) {
            if (info.status === ConnectionStatus.Establishment) {
                est = est + 1;
            } else if (info.status === ConnectionStatus.PeerValidation) {
                val = val + 1;
            } else if (info.status === ConnectionStatus.PeerReady) {
                ok = ok + 1;
            }
        }

        console.log('stats: established='+est+' in validation='+val+' validated='+ok);
        */

        if (this.getCallIdForEndpoint(endpoint) === undefined) {

            const remoteAddress = LinkupAddress.fromURL(endpoint);

            const callId = new RNGImpl().randomHexString(BITS_FOR_CALL_ID);

            this.connectionInfo.set(callId, { remoteEndpoint: endpoint, callId: callId, status: ConnectionStatus.Establishment, timestamp: Date.now()});

            let conn = new WebRTCConnection(this.linkupManager, this.localAddress as LinkupAddress, remoteAddress, callId, this.connectionReadyCallback);


            conn.setMessageCallback(this.messageCallback);

            this.connections.set(callId, conn);

            conn.open('swarm-comms-channel');

        }

    }

    disconnect(callId: CallId) {

        const conn = this.connections.get(callId);

        if (conn === undefined) {
            throw new Error('Asked to disconnect callId ' + callId + ' but there is no such connection.');
        }

        conn.close();

        this.connectionCloseCleanup(callId);
    }

    queryForListeningAddresses(addresses: Array<LinkupAddress>) {
        this.linkupManager.queryForListeningAddresses(this.localAddress?.linkupId as string, addresses);
    }

    getConnectionEndpoint(callId: CallId) {
       return this.connectionInfo.get(callId)?.remoteEndpoint;
    }

    getCallIdForEndpoint(endpoint: Endpoint) {

        let callId = undefined;

        for (const connInfo of this.connectionInfo.values()) {
            if (connInfo.remoteEndpoint === endpoint) {
                callId = connInfo.callId;
            }
        }

        return callId;
    }


    // Sends a raw message, even if no peer has been configured for that connection.
    // Meant to be used in peer authentication & set up.

    sendMessage(message: Message) {

        if (message.source !== this.localEndpoint) {
            throw new Error('Attempted to send message from endpoint ' + message.source + ' but local endpoint is ' + this.localEndpoint);
        }

        let conn = this.connections.get(message.callId);

        if (conn === undefined) {
            throw new Error('Attempted to send message through callId ' + message.callId + ' but there is no such call at the moment.');
        }

        let connInfo = this.connectionInfo.get(message.callId);

        if (connInfo?.remoteEndpoint !== message.destination) {
            throw new Error('Attempted to send a message to endpoint ' + message.destination + ' through call ' + message.callId + ', but that is connected to ' + connInfo?.remoteEndpoint + ' instead.');
        }

        conn.send(message);

    }


    // peer management: local peer, (de)register peers bound to current connections,
    //                  get connected peers (also, which run a given agent)

    getLocalPeer() : Peer {
        return this.localPeer as Peer;
    }

    setLocalPeer(peer: Peer) {
        this.localPeer = peer;
    }

    registerConnectedPeer(peer: Peer) {
        this.peers.set(peer.getId(), peer);

        const info  = this.connectionInfo.get(peer.getCallId() as CallId) as ConnectionInfo;
        
        info.status = ConnectionStatus.PeerReady;
        info.peerId = peer.getId();

        this.sendLocalEvent({type: EventType.LocalPeerAddition, content: peer.getId()});

        this.sendAgentSet(peer.getId());
    }

    deregisterConnectedPeer(peer: Peer) {
        this.deregisterConnectedPeerById(peer.getId());

        const info  = this.connectionInfo.get(peer.getCallId() as CallId) as ConnectionInfo;
        
        info.status = ConnectionStatus.PeerValidation;
        info.peerId = undefined;
    }

    deregisterConnectedPeerById(id: PeerId) {
        this.sendLocalEvent({type: EventType.LocalPeerRemoval, content: id});
        this.peers.delete(id);
    }

    getConnectedPeer(id: PeerId) {
        return this.peers.get(id);
    }

    getConnectedPeersIdSet() : Set<PeerId> {
        return new Set(this.peers.keys());
    }

    getConnectedPeersWithAgent(agentId: AgentId) : Array<PeerId> {
        let peers = new Array<PeerId>();

        for (let peerId of this.peers.keys()) {
            let agentSet = this.remoteAgentSets.get(peerId);

            if (agentSet?.has(agentId)) {
                peers.push(peerId);
            }
        }

        return peers;
    }

    // locally running agent set management

    registerLocalAgent(agent: Agent) {
        this.agents.set(agent.getId(), agent);

        this.localAgentSet.add(agent.getId());

        agent.ready(this);

        this.sendLocalEvent({type: EventType.LocalAgentAddition, content: agent.getId()})

        let delta = { additions: [agent.getId()], removals: [], hash: this.localAgentSet.hash() };

        for (const peer of this.peers.values()) {
            this.sendAgentSetChange(peer.getId(), delta);
        }

    }

    deregisterLocalAgent(agent: Agent) {
        this.deregisterLocalAgentById(agent.getId());
    }

    deregisterLocalAgentById(id: AgentId) {
        this.sendLocalEvent({type: EventType.LocalAgentRemoval, content: id});
        this.agents.delete(id);

        this.localAgentSet.removeByHash(id);

        let delta = { additions: [], removals: [id], hash: this.localAgentSet.hash() };

        for (const peer of this.peers.values()) {
            this.sendAgentSetChange(peer.getId(), delta);
        }
    }

    getLocalAgent(id: AgentId) {
        return this.agents.get(id);
    }

    getLocalAgentIdSet() {
        return new Set<AgentId>(this.agents.keys());
    }


    // send an event that will be received by all local agents

    sendLocalEvent(ev: Event) {

        Swarm.logger.trace('Swarm ' + this.topic + ' for peer ' + this.localPeer?.getId() + ' sending event ' + ev.type + ' with content ' + ev.content);

        for (const agent of this.agents.values()) {
            agent.receiveLocalEvent(ev);
        }
    }


    private connectionCloseCleanup(callId: CallId) {
        this.connectionInfo.delete(callId);
        this.connections.delete(callId);

        this.sendLocalEvent({type: EventType.LocalConnectionClosed, content: callId});
    }

    private receiveMessage(msg: Message) {
        let agent = this.agents.get(msg.agentId);
        agent?.receiveMessage(msg);
    }

    private receiveControlMessage(msg: ControlMessage) {

        if (msg.type === ControlMessageType.RequestAgentSetHash) {
            this.sendAgentSetHash(msg.source);
        } else if (msg.type === ControlMessageType.SendAgentSetHash) {
            let remoteHash = msg.content;
            let localCopy = this.remoteAgentSets.get(msg.source);

            if (localCopy === undefined || localCopy.hash() !== remoteHash) {
                this.requestAgentSet(msg.source);
            } 
        } else if (msg.type === ControlMessageType.RequestAgentSet) {
            this.sendAgentSet(msg.source);
        } else if (msg.type === ControlMessageType.SendAgentSet) {
            this.receiveAgentSet(msg.source, msg.content as Array<AgentId>);
        } else if (msg.type === ControlMessageType.NotifyAgentSetChange) {
            this.receiveAgentSetChange(msg.source, msg.content as {additions: Array<AgentId>, removals: Array<AgentId>, hash: Hash});
        } else if (msg.type === ControlMessageType.SendMessageToAgent) {
            let peerMsg = { 
                sourceId: msg.source,
                destinationId: msg.destination,
                agentId: msg.content?.agentId,
                content: msg.content?.content
            } as PeerMessage;
            this.receivePeerMessage(peerMsg);
        }

    }
    
    private receivePeerMessage(msg: PeerMessage) {
        let agent = this.agents.get(msg.agentId);
        agent?.receivePeerMessage(msg);
    }

    private requestAgentSetHash(destination: PeerId) {
        let msg = {
            source: this.localPeer?.getId() as PeerId,
            destination: destination,
            type: ControlMessageType.RequestAgentSetHash,
        } as ControlMessage;

        this.sendControlMessage(msg);        
    }

    private sendAgentSetHash(destination: PeerId) {
        let msg = { 
            source: this.localPeer?.getId() as PeerId,
            destination: destination,
            type: ControlMessageType.SendAgentSetHash,
            content: this.localAgentSet.hash()
        } as ControlMessage;

        this.sendControlMessage(msg);
    }

    private requestAgentSet(destination: PeerId) {
        let msg = {
            source: this.localPeer?.getId() as PeerId,
            destination: destination,
            type: ControlMessageType.RequestAgentSet,
        } as ControlMessage;

        this.sendControlMessage(msg);
    }

    private sendAgentSet(destination: PeerId) {
        let msg = { 
            source: this.localPeer?.getId() as PeerId,
            destination: destination,
            type: ControlMessageType.SendAgentSet,
            content: Array.from(this.localAgentSet.values())
        } as ControlMessage;

        this.sendControlMessage(msg);
    }

    private receiveAgentSet(peerId: PeerId, agentIds: Array<AgentId>) {
        let newAgentSet = new Set(agentIds);

        let oldAgentSet = this.getOrCreateAgentSetForPeer(peerId);

        let additions = new Array<AgentId>();
        let removals = new Array<AgentId>();

        for (const agentId of newAgentSet) {
            if (!oldAgentSet.has(agentId)) {
                additions.push(agentId);
            }
        }

        for (const agentId of oldAgentSet.values()) {
            if (!newAgentSet.has(agentId)) {
                removals.push(agentId);
            }
        }

        this.applyAgentSetChange(peerId, additions, removals);
    }

    private sendAgentSetChange(destination: PeerId, delta: {additions: Array<AgentId>, removals: Array<AgentId>, hash: Hash}) {
        let msg = { 
            source: this.localPeer?.getId() as PeerId,
            destination: destination,
            type: ControlMessageType.NotifyAgentSetChange,
            content: delta
        } as ControlMessage;

        this.sendControlMessage(msg);

    }

    private receiveAgentSetChange(peerId: PeerId, delta: {additions: Array<AgentId>, removals: Array<AgentId>, hash: Hash}) {

        let oldAgentSet = this.remoteAgentSets.get(peerId);

        if (oldAgentSet === undefined) {
            oldAgentSet = new HashedSet<AgentId>();
            this.remoteAgentSets.set(peerId, oldAgentSet);
        }

        let removals = delta.removals;
        let actualRemovals = new Array<AgentId>();

        if (removals !== undefined && removals.length > 0) {
            for (const agentId of removals) {
                if (oldAgentSet.has(agentId)) {
                    actualRemovals.push(agentId);
                }
            }
        }

        let additions = delta.additions;
        let actualAdditions = new Array<AgentId>();

        if (additions !== undefined && additions.length > 0) {
            for (const agentId of additions) {
                if (!oldAgentSet.has(agentId)) {
                    actualAdditions.push(agentId);
                }
            }
        }

        this.applyAgentSetChange(peerId, additions, removals);

        // check if results are the expected ones, if not ask for the complete set
        if (delta.hash !== undefined) {
            if (delta.hash !== oldAgentSet.hash()) {
                this.requestAgentSet(peerId);
            }
        }

    }

    private applyAgentSetChange(peerId: PeerId, additions: Array<AgentId>, removals: Array<AgentId>) {
        
        let oldAgentSet = this.getOrCreateAgentSetForPeer(peerId);

        if (removals.length > 0) {
            this.sendLocalEvent({type: EventType.RemoteAgentRemovals, content: {peerId: peerId, agentIds: removals }});
        }

        for (const agentId of removals) {
            oldAgentSet.remove(agentId);
        }

        for (const agentId of additions) {
            oldAgentSet.add(agentId);
        }

        if (additions.length > 0) {
            this.sendLocalEvent({type: EventType.RemoteAgentAdditions, content: {peerId: peerId, agentIds: additions}});
        }

    }

    private getOrCreateAgentSetForPeer(peerId: PeerId) {
        let agentSet = this.remoteAgentSets.get(peerId);

        if (agentSet === undefined) {
            agentSet = new HashedSet<AgentId>();
            this.remoteAgentSets.set(peerId, agentSet);
        }

        return agentSet;
    }

    sendPeerMessage(message: PeerMessage) {
        let controlMessage = {
            source: message.sourceId,
            destination: message.destinationId,
            type: ControlMessageType.SendMessageToAgent,
            content: { agentId: message.agentId, content: message.content }
        } as ControlMessage;

        this.sendControlMessage(controlMessage);
    }

    private sendControlMessage(message: ControlMessage) {
        if (this.localPeer === undefined) {
            throw new Error('Local peer has not been set, cannot send.');
        }

        if (message.source !== this.localPeer?.getId()) {
            throw new Error('Message source is not local peer, refusing to send.');
        }

        let destPeer = this.peers.get(message.destination);

        if (destPeer === undefined) {
            throw new Error("Message destination '" + message.destination + "' is not connected to this peer, can't send.");
        }

        let conn = this.connections.get(destPeer.getCallId());

        if (conn === undefined) {
            throw new Error("Connection to peer '" + message.destination + "' was lost while peparing to send message, sorry.");
        }

        if (!conn.channelIsOperational()) {
            throw new Error("Connection to peer '" + message.destination + "' is not operational at this time, sorry.");
        }

        let data = JSON.stringify(message);

        Swarm.logger.debug('Sending message from ' + this.localPeer.getId() + ': ' + data );

        conn.send(data);
    }
}

export { Swarm, CallId, Endpoint, Event, EventType, Message, PeerMessage };