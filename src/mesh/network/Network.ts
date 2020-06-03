import { WebRTCConnection } from '../transport/WebRTCConnection';
import { Agent, AgentId } from './Agent';
import { LinkupManager } from '../linkup/LinkupManager';
import { LinkupAddress } from '../linkup/LinkupAddress';
import { RNGImpl } from 'crypto/random';
import { Logger, LogLevel } from 'util/logging';

type Endpoint = string;

type ConnectionId  = string;

type Event = { type: string, content: any };

const BITS_FOR_CONN_ID = 128;

enum NetworkEventType {
    AgentSetChange          = 'agent-set-change',
    ConnectionStatusChange  = 'connection-status-change',
    RemoteAddressListening  = 'remote-address-listening',
};

enum AgentSetChange {
    Addition = 'addition',
    Removal  = 'removal'
};

type AgentSetChangeEvent = {
    type: NetworkEventType.AgentSetChange,
    content: {
        change: AgentSetChange,
        agentId: AgentId
    }
};

enum ConnectionStatus {
    Received     = 'received',
    Establishing = 'establishing',
    Ready        = 'ready',
    Closed       = 'closed'
}

type ConnectionStatusChangeEvent = {
    type: NetworkEventType.ConnectionStatusChange,
    content: {
        connId         : ConnectionId,
        localEndpoint  : Endpoint,
        remoteEndpoint : Endpoint,
        status         : ConnectionStatus
    }
}

type RemoteAddressListeningEvent = {
    type: NetworkEventType.RemoteAddressListening,
    content: {
        remoteEndpoint: Endpoint
    }
}

type Message = { connectionId: ConnectionId, source: Endpoint, destination: Endpoint, agentId: AgentId, content: any }

type ConnectionInfo = { 
    localEndpoint: Endpoint,
    remoteEndpoint: Endpoint, 
    connId : ConnectionId, 
    status: ConnectionStatus,
    timestamp: number,
    requestedBy: Set<AgentId>
}

// all the following in seconds

const TickInterval = 5;

const ConnectionEstablishmentTimeout = 10;

class Network {

    static logger = new Logger(Network.name, LogLevel.INFO);
    static connLogger = new Logger(Network.name + ' conn', LogLevel.INFO);
    static messageLogger = new Logger(Network.name + ' msg', LogLevel.INFO);
    
    linkupManager : LinkupManager;

    listening   : Set<Endpoint>;
    connections : Map<ConnectionId, WebRTCConnection>;
    agents      : Map<string, Agent>;

    connectionInfo : Map<ConnectionId, ConnectionInfo>;
    deferredInitialMessages : Map<ConnectionId, any>;
    
    messageCallback : (data: any, conn: WebRTCConnection) => void;

    connectionReadyCallback : (conn: WebRTCConnection) => void;

    newConnectionRequestCallback : (sender: LinkupAddress, receiver: LinkupAddress, callId: string, message: any) => void;

    tick : () => void;

    intervalRef : any;

    constructor(linkupManager = new LinkupManager()) {

        this.linkupManager = linkupManager;

        this.listening   = new Set();
        this.connections = new Map();
        this.agents      = new Map();

        this.connectionInfo          = new Map();
        this.deferredInitialMessages = new Map();

        this.messageCallback = (data: any, conn: WebRTCConnection) => {

            Network.messageLogger.debug(() => 'Endpoint ' + this.connectionInfo.get(conn.getCallId())?.localEndpoint + ' received message: ' + data);

            const connectionId = conn.getCallId(); 
            const connInfo = this.connectionInfo.get(connectionId);

            const message = JSON.parse(data);

            if (connInfo !== undefined) {                
                if (message.connectionId !== undefined) {
                    
                    // plain message, not peer to peer yet.
                    const msg = message as Message;

                    if (msg.connectionId === connectionId &&
                        msg.source       === connInfo.remoteEndpoint && 
                        msg.destination  === connInfo.localEndpoint)

                            this.receiveMessage(msg);
                }
            }
        };

        this.connectionReadyCallback = (conn: WebRTCConnection) => {
            const connectionId = conn.getCallId();
            const connInfo = this.connectionInfo.get(connectionId);
            if (connInfo === undefined) {
                conn.close();
            } else {
                this.connections.set(connectionId, conn);
                connInfo.status = ConnectionStatus.Ready;
                const ev: ConnectionStatusChangeEvent = {
                    type: NetworkEventType.ConnectionStatusChange, 
                    content: {
                        connId          : connectionId,
                        localEndpoint   : connInfo.localEndpoint,
                        remoteEndpoint  : connInfo.remoteEndpoint,
                        status          : ConnectionStatus.Ready
                    }
                };
                this.broadcastLocalEvent(ev);
            }
        }

        this.newConnectionRequestCallback = (sender: LinkupAddress, receiver: LinkupAddress, connectionId: string, message: any) => {

            let connInfo = this.connectionInfo.get(connectionId);

            if (connInfo === undefined) {
                connInfo = {
                    localEndpoint: receiver.url(),
                    remoteEndpoint: sender.url(), 
                    connId: connectionId, 
                    status: ConnectionStatus.Received,
                    timestamp: Date.now(),
                    requestedBy: new Set()
                };

                this.connectionInfo.set(connectionId, connInfo);
            }

            if (connInfo.localEndpoint === receiver.url() &&
                connInfo.remoteEndpoint === sender.url()) {

                    if (connInfo.status === ConnectionStatus.Establishing) {
                        this.acceptReceivedConnectionMessages(connectionId, message);
                    } else if (connInfo.status === ConnectionStatus.Received) {
                        this.deferReceivedConnectionMessage(connectionId, message);

                        let ev: ConnectionStatusChangeEvent = {
                            type: NetworkEventType.ConnectionStatusChange,
                            content: {
                                connId          : connectionId,
                                localEndpoint   : connInfo.localEndpoint,
                                remoteEndpoint  : connInfo.remoteEndpoint,
                                status          : ConnectionStatus.Received 
                            }
                        }

                        this.broadcastLocalEvent(ev);
                    }

                }          
        };

        this.tick = () => {

            let toCleanUp = new Array<ConnectionId>();

            // check connection health / startup timeouts
            // check agent set request timeout if connection is healthy

            for (const conn of this.connections.values()) {
                let callId = conn.getCallId();

                let info = this.connectionInfo.get(callId) as ConnectionInfo;

                if (info.status === ConnectionStatus.Received || info.status === ConnectionStatus.Establishing) {
                    if (Date.now() > info.timestamp + (1000 * ConnectionEstablishmentTimeout)) {
                        toCleanUp.push(callId);
                    } 
                } else if (!conn.channelIsOperational()) {
                    toCleanUp.push(callId);
                }

            }

            for (const connectionId of toCleanUp) {

                let conn = this.connections.get(connectionId);

                this.connectionCloseCleanup(connectionId);

                try {
                    conn?.close();
                } catch (e) {
                    //
                }
                
            }
        };

        this.intervalRef = window.setInterval(this.tick, TickInterval * 1000);

    }

    private acceptReceivedConnectionMessages(connId: ConnectionId, message?: any) {

        if (message === undefined) {
            message = this.deferredInitialMessages.get(connId);
            this.deferredInitialMessages.delete(connId);
        }

        if (message !== undefined) {
            let conn = this.connections.get(connId);
            let connInfo = this.connectionInfo.get(connId) as ConnectionInfo;
    
            if (conn === undefined) {
                const receiver = LinkupAddress.fromURL(connInfo.localEndpoint);
                const sender   = LinkupAddress.fromURL(connInfo.remoteEndpoint);
                conn = new WebRTCConnection(this.linkupManager, receiver, sender, connId, this.connectionReadyCallback);
            }
    
            conn.setMessageCallback(this.messageCallback);
            conn.answer(message);


        }
    }

    private deferReceivedConnectionMessage(connId: ConnectionId, message: any) {
        this.deferredInitialMessages.set(connId, message);
    }

    // Network listen, shutdown

    listen(endpoint: Endpoint) {

        let address = LinkupAddress.fromURL(endpoint);

        this.listening.add(endpoint);

        this.linkupManager.listenForQueryResponses(endpoint, (ep: string, addresses: Array<LinkupAddress>) => {

            if (this.listening.has(ep)) {
                Network.connLogger.debug(ep + ' received listening notice of ' + addresses.map((l:LinkupAddress) => l.url()));
                for (const address of addresses) {

                    let ev: RemoteAddressListeningEvent = {
                        type: NetworkEventType.RemoteAddressListening,
                        content: {
                            remoteEndpoint: address.url()
                        }
                    };

                    this.broadcastLocalEvent(ev);
                }
            } else {
                Network.connLogger.debug('received wrongly addressed listenForQueryResponse message, was meant for ' + ep + ' which is not listening in this network node.');
            }

        });

        Network.logger.debug('Listening for endpoint ' + endpoint);
        this.linkupManager.listenForMessagesNewCall(address, this.newConnectionRequestCallback);
    }

    shutdown() {
        this.linkupManager.shutdown();
        if (this.intervalRef !== undefined) {
            window.clearInterval(this.intervalRef);
            this.intervalRef = undefined;
        }  
        for (const conn of this.connections.values()) {
            this.connectionInfo.delete(conn.getCallId());
            this.connections.delete(conn.getCallId());
            conn.close();
        }
    }

    // Connection management: connect-disconnect, find out which addresses are online
    //                        at the moment, recover the endpoint for a current callId.

    connect(local: Endpoint, remote: Endpoint, requestedBy: AgentId) : ConnectionId {


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

        Network.connLogger.debug(local + ' is asking for connection to ' + remote);

        const localAddress  = LinkupAddress.fromURL(local);
        const remoteAddress = LinkupAddress.fromURL(remote);

        const callId = new RNGImpl().randomHexString(BITS_FOR_CONN_ID);

        this.connectionInfo.set(
            callId, 
            { 
                localEndpoint: local, 
                remoteEndpoint: remote, 
                connId: callId, status: ConnectionStatus.Establishing, 
                timestamp: Date.now(),
                requestedBy: new Set([requestedBy])
            });

        let conn = new WebRTCConnection(this.linkupManager, localAddress, remoteAddress, callId, this.connectionReadyCallback);


        conn.setMessageCallback(this.messageCallback);

        this.connections.set(callId, conn);

        conn.open('mesh-network-channel');

        return callId;
    }

    acceptConnection(connId: ConnectionId, requestedBy: AgentId) {

        let connInfo = this.connectionInfo.get(connId);

        if (connInfo === undefined) {
            throw new Error('Connection with id ' + connId + ' no longer exists (if it ever did).');
        }

        if (connInfo.status === ConnectionStatus.Received) {
            this.acceptReceivedConnectionMessages(connId);
            connInfo.status = ConnectionStatus.Establishing;
        }

        if (connInfo.status !== ConnectionStatus.Closed) {
            connInfo.requestedBy.add(requestedBy);
        }
    }

    releaseConnectionIfExists(id: ConnectionId, requestedBy: AgentId) {
        try {
            this.releaseConnection(id, requestedBy);
        } catch (e) {
            // pass
        }
    }

    releaseConnection(id: ConnectionId, requestedBy: AgentId) {

        const conn = this.connections.get(id);

        if (conn === undefined) {
            throw new Error('Asked to disconnect callId ' + id + ' but there is no such connection.');
        }

        let connInfo = this.connectionInfo.get(id);

        Network.connLogger.debug('connection ' + id + ' is being released by agent ' + requestedBy + ' on ' + connInfo?.localEndpoint);

        connInfo?.requestedBy.delete(requestedBy);

        if (connInfo?.requestedBy.size === 0) {

            Network.connLogger.debug('connection ' + id + ' is no longer being used on ' + connInfo?.localEndpoint + ', closing');

            conn.close();

            this.connectionCloseCleanup(id);
        }
    }

    checkConnection(id: ConnectionId) {
        
        if (this.connectionIsReady(id)) {
            let operational = this.connections.get(id)?.channelIsOperational();

            if (!operational) {
                this.connectionCloseCleanup(id);
            }

            return operational;
        } else {
            return false;
        }
        
        
    }

    queryForListeningAddresses(source: LinkupAddress, targets: Array<LinkupAddress>) {

        Network.connLogger.log(source.url() + ' asking if any is online: ' + targets.map((l: LinkupAddress) => l.url()), LogLevel.DEBUG);

        if (this.listening.has(source.url())) {
            this.linkupManager.queryForListeningAddresses(source.url(), targets);
        } else {
            throw new Error('Looking for onlina targets for endpoint ' + source.url() + ' but that endpoint is not listening on this network.');
        }

        
    }

    getAllConnectionsInfo() : Array<ConnectionInfo> {
        return Array.from(this.connectionInfo.values()).map((ci: ConnectionInfo) => Object.assign({}, ci));
    }

    getConnectionInfo(id: ConnectionId) : ConnectionInfo | undefined {
        let ci = this.connectionInfo.get(id);

        if (ci !== undefined) {
            ci = Object.assign({}, ci);
        }

        return ci;
    }

    connectionIsReady(id: ConnectionId): boolean {
        return this.connectionInfo.get(id)?.status === ConnectionStatus.Ready;
    }

    getConnIdsForEndpoints(local: Endpoint, remote: Endpoint) : Set<ConnectionId> {

        let connIds = new Set<ConnectionId>();

        for (const connInfo of this.connectionInfo.values()) {
            if (connInfo.localEndpoint === local && connInfo.remoteEndpoint === remote) {
                connIds.add(connInfo.connId);
                break;
            }
        }

        return connIds;
    }


    // Sends a raw message, even if no peer has been configured for that connection.
    // Meant to be used in peer authentication & set up.

    sendMessage(connId: ConnectionId, agentId: AgentId, content: any) {

        const conn = this.connections.get(connId);
        const connInfo = this.connectionInfo.get(connId);

        if (conn === undefined || connInfo === undefined) {
            throw new Error('Attempted to send message on connection ' + connId + ', but the connection is no longer available.');
        }

        let message: Message = {
            connectionId: connId,
            source: connInfo.localEndpoint,
            destination: connInfo.remoteEndpoint,
            agentId: agentId,
            content: content
        };

        conn.send(JSON.stringify(message));

    }



    // locally running agent set management

    registerLocalAgent(agent: Agent) {
        this.agents.set(agent.getAgentId(), agent);


        agent.ready(this);

        const ev: AgentSetChangeEvent = {
            type: NetworkEventType.AgentSetChange,
            content: {
                agentId: agent.getAgentId(),
                change: AgentSetChange.Addition
            }
        }

        this.broadcastLocalEvent(ev)
    }

    deregisterLocalAgent(agent: Agent) {
        this.deregisterLocalAgentById(agent.getAgentId());
    }

    deregisterLocalAgentById(id: AgentId) {

        const ev: AgentSetChangeEvent = {
            type: NetworkEventType.AgentSetChange,
            content: {
                agentId: id,
                change: AgentSetChange.Removal
            }
        }

        this.broadcastLocalEvent(ev);
        this.agents.delete(id);
    }

    getLocalAgent(id: AgentId) {
        return this.agents.get(id);
    }

    getLocalAgentIdSet() {
        return new Set<AgentId>(this.agents.keys());
    }


    // send an event that will be received by all local agents

    broadcastLocalEvent(ev: Event) {

        Network.logger.trace('Network sending event ' + ev.type + ' with content ' + JSON.stringify(ev.content));

        for (const agent of this.agents.values()) {
            agent.receiveLocalEvent(ev);
        }
    }


    private connectionCloseCleanup(id: ConnectionId) {

        let connInfo = this.connectionInfo.get(id) as ConnectionInfo;

        let ev: ConnectionStatusChangeEvent = {
            type: NetworkEventType.ConnectionStatusChange,
            content: {
                connId          : id,
                localEndpoint   : connInfo.localEndpoint,
                remoteEndpoint  : connInfo.remoteEndpoint,
                status          : ConnectionStatus.Closed
            }
        }

        this.broadcastLocalEvent(ev);

        this.connectionInfo.delete(id);
        this.connections.delete(id);
        this.deferredInitialMessages.delete(id);


    }

    private receiveMessage(msg: Message) {

        let agent = this.agents.get(msg.agentId);
        agent?.receiveMessage(msg.connectionId, msg.source, msg.destination, msg.content);
    }
    
}

export { Network, ConnectionId, Endpoint, Event, NetworkEventType, ConnectionStatusChangeEvent, ConnectionStatus, AgentSetChangeEvent, AgentSetChange, RemoteAddressListeningEvent, Message };