import { Agent, AgentId } from '../../service/Agent';
import { AgentEvent, AgentPod } from '../../service/AgentPod';
import { Logger, LogLevel } from 'util/logging';
import { LinkupAddress } from 'net/linkup/LinkupAddress';
import { LinkupManager } from 'net/linkup/LinkupManager';
import { Connection } from 'net/transport/Connection';
import { WebRTCConnection } from 'net/transport/WebRTCConnection';
import { RNGImpl } from 'crypto/random';
import { SignallingServerConnection } from 'net/linkup/SignallingServerConnection';
import { WebSocketConnection } from 'net/transport/WebSocketConnection';
import { LinkupManagerHost, LinkupManagerEvent, NewCallMessageCallback } from 'net/linkup';
import { WebRTCConnectionCommand, WebRTCConnectionEvent, WebRTCConnectionProxy } from 'net/transport';
import { Identity } from 'data/identity';

type Endpoint = string;

type ConnectionId  = string;

const BITS_FOR_CONN_ID = 128;

enum NetworkEventType {
    ConnectionStatusChange = 'connection-status-change',
    RemoteAddressListening = 'remote-address-listening',
    MessageReceived        = 'message-received',
    LinkupMessageReceived  = 'linkup-message-received'
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

type MessageReceivedEvent = {
    type: NetworkEventType.MessageReceived,
    content: Message
}

type Message = {
    connectionId: ConnectionId, 
    source: Endpoint, 
    destination: Endpoint, 
    agentId: AgentId, 
    content: any
};

type LinkupMessageReceivedEvent = {
    type: NetworkEventType.LinkupMessageReceived,
    content: LinkupMessage
}

type LinkupMessage = {
    source: Endpoint,
    destination: Endpoint,
    agentId: AgentId,
    content: any
}

type ConnectionInfo = { 
    localEndpoint: Endpoint,
    remoteEndpoint: Endpoint, 
    connId : ConnectionId, 
    remoteInstanceId?: string, // see the note in instanceIds in class SignallingServerConnection
    status: ConnectionStatus,
    timestamp: number,
    requestedBy: Set<AgentId>
}

// proxy here refers to object proxy, i.e. have a bridged WebRTCConnection that bridges 
// LinkupManager back to the one here (necessary in the browser because Web Workers can't
// create WebRTC connections).

type NetworkAgentProxyConfig = {
    linkupEventIngestFn?: (ev: LinkupManagerEvent) => void, 
    webRTCCommandFn?: (cmd: WebRTCConnectionCommand) => void
};

// all the following in seconds

const TickInterval = 5;

const ConnectionEstablishmentTimeout = 10;

class NetworkAgent implements Agent {

    static AgentId = 'network-agent';

    static logger        = new Logger(NetworkAgent.name, LogLevel.INFO);
    static connLogger    = new Logger(NetworkAgent.name + ' conn', LogLevel.INFO);
    static messageLogger = new Logger(NetworkAgent.name + ' msg', LogLevel.INFO);
    
    logger        : Logger;
    connLogger    : Logger;
    messageLogger : Logger;

    pod?: AgentPod;

    linkupManager : LinkupManager;

    proxyConfig?: NetworkAgentProxyConfig;

    listening    : Set<Endpoint>;
    linkupMessageListening : Set <Endpoint>;
    connections  : Map<ConnectionId, Connection>;

    connectionInfo : Map<ConnectionId, ConnectionInfo>;
    deferredInitialMessages : Map<ConnectionId, Array<{instanceId: string, message: any}>>;
    
    messageCallback : (data: any, conn: Connection) => void;

    connectionReadyCallback : (conn: Connection) => void;

    newConnectionRequestCallback : NewCallMessageCallback;

    linkupMessageCallback : (sender: LinkupAddress, receiver: LinkupAddress, message: any) => void;

    tick : () => void;

    intervalRef : any;

    linkupManagerHost?: LinkupManagerHost;
    webRTCConnEventIngestFn?: (ev: WebRTCConnectionEvent) => void;
    connProxies?: Map<string, WebRTCConnectionProxy>;

    testingMode = false;

    getAgentId(): string {
        return NetworkAgent.AgentId; 
    }

    constructor(linkupManager = new LinkupManager(), proxyConfig?: NetworkAgentProxyConfig) {

        this.logger        = NetworkAgent.logger;
        this.connLogger    = NetworkAgent.connLogger;
        this.messageLogger = NetworkAgent.messageLogger;

        this.linkupManager = linkupManager;
        this.proxyConfig = proxyConfig;

        this.listening    = new Set();
        this.linkupMessageListening = new Set();
        this.connections  = new Map();

        this.connectionInfo          = new Map();
        this.deferredInitialMessages = new Map();

        this.messageCallback = (data: any, conn: Connection) => {

            this.messageLogger.debug(() => 'Endpoint ' + this.connectionInfo.get(conn.getConnectionId())?.localEndpoint + ' received message from ' + this.connectionInfo.get(conn.getConnectionId())?.remoteEndpoint + ':\n' + data);

            const connectionId = conn.getConnectionId(); 
            const connInfo = this.connectionInfo.get(connectionId);
            try {
                const message = JSON.parse(data);

                if (connInfo !== undefined) {           
                    
                    if (connInfo.status !== ConnectionStatus.Ready) {
                        this.connectionReadyCallback(conn);
                    }

                    if (message.connectionId !== undefined) {
                        
                        // plain message, not peer to peer yet.
                        const msg = message as Message;

                        if (msg.connectionId === connectionId &&
                            msg.source       === connInfo.remoteEndpoint && 
                            msg.destination  === connInfo.localEndpoint)

                                this.receiveMessage(msg);
                    }
                }
            } catch (e) {
                if (!this.testingMode) {
                    this.messageLogger.warning(() => 'Endpoint ' + this.connectionInfo.get(conn.getConnectionId())?.localEndpoint + ' could not process received message from ' + this.connectionInfo.get(conn.getConnectionId())?.remoteEndpoint + ', error is:\n', e);
                    this.messageLogger.warning('full message content follows:', data);    
                }
            }
        };

        this.connectionReadyCallback = (conn: Connection) => {
            const connectionId = conn.getConnectionId();
            const connInfo = this.connectionInfo.get(connectionId);
            if (connInfo === undefined) {
                NetworkAgent.connLogger.trace(() => 'Connection ready callback invoked for ' + connectionId + ', but conn. info not present. Attempting to close.');
                conn.close();
            } else {

                NetworkAgent.connLogger.trace(() => 'Connection ready callback invoked for ' + connectionId + ', status was ' + connInfo.status + ' in ' + connInfo.localEndpoint);

                if (connInfo.status !== ConnectionStatus.Ready) {
                    this.connections.set(connectionId, conn);
                    connInfo.status = ConnectionStatus.Ready;
                    if (connInfo.remoteInstanceId === undefined) {
                        connInfo.remoteInstanceId = conn.remoteInstanceId;
                    }
                    const ev: ConnectionStatusChangeEvent = {
                        type: NetworkEventType.ConnectionStatusChange, 
                        content: {
                            connId          : connectionId,
                            localEndpoint   : connInfo.localEndpoint,
                            remoteEndpoint  : connInfo.remoteEndpoint,
                            status          : ConnectionStatus.Ready
                        }
                    };

                    NetworkAgent.connLogger.trace(() => 'Broadcasting connection readiness for ' + connectionId + ', status now is ' + connInfo.status + ' in ' + connInfo.localEndpoint);

                    this.pod?.broadcastEvent(ev);
                }

            }
        }

        this.newConnectionRequestCallback = (sender: LinkupAddress, receiver: LinkupAddress, connectionId: string, instanceId: string, message: any) => {

            let connInfo = this.connectionInfo.get(connectionId);

            let isNew = connInfo === undefined;

            if (connInfo === undefined) {
                connInfo = {
                    localEndpoint: receiver.url(),
                    remoteEndpoint: sender.url(), 
                    connId: connectionId,
                    remoteInstanceId: instanceId,
                    status: ConnectionStatus.Received,
                    timestamp: Date.now(),
                    requestedBy: new Set()
                };

                this.connectionInfo.set(connectionId, connInfo);
            }

            /*if (connInfo.localEndpoint === receiver.url() &&
                connInfo.remoteEndpoint === sender.url() &&
                connInfo.remoteEndpoint !== instanceId) {

                    console.log('MISMATCH')
                    CONSOL
            }*/

            if (connInfo.localEndpoint === receiver.url() &&
                connInfo.remoteEndpoint === sender.url() &&
                connInfo.remoteInstanceId === instanceId) {

                    if (connInfo.status === ConnectionStatus.Establishing) {
                        this.acceptReceivedConnectionMessages(connectionId, instanceId, message);
                    } else if (connInfo.status === ConnectionStatus.Received) {
                        this.deferReceivedConnectionMessage(connectionId, instanceId, message);

                        if (isNew) {
                            let ev: ConnectionStatusChangeEvent = {
                                type: NetworkEventType.ConnectionStatusChange,
                                content: {
                                    connId          : connectionId,
                                    localEndpoint   : connInfo.localEndpoint,
                                    remoteEndpoint  : connInfo.remoteEndpoint,
                                    status          : ConnectionStatus.Received 
                                }
                            }
    
                            this.pod?.broadcastEvent(ev);
                        }
                        
                    }

                }          
        };

        this.linkupMessageCallback = (sender: LinkupAddress, receiver: LinkupAddress, message: any) => {

            if (this.linkupMessageListening.has(receiver.url())) {
                const msg = message as LinkupMessage;

                if (sender.url() === msg.source && receiver.url() === msg.destination) {
                    const destAgentId = msg.agentId;
                    const destAgent   = this.pod?.getAgent(destAgentId);

                    if (destAgent !== undefined) {
                        let ev: LinkupMessageReceivedEvent = {
                            type: NetworkEventType.LinkupMessageReceived,
                            content: msg
                        }
                        destAgent.receiveLocalEvent(ev);
                    }

                }
            }

        };

        this.tick = () => {

            let toCleanUp = new Array<ConnectionId>();

            // check connection health / startup timeouts
            // check agent set request timeout if connection is healthy

            for (const conn of this.connections.values()) {
                let callId = conn.getConnectionId();

                let info = this.connectionInfo.get(callId) as ConnectionInfo;

                if (info.status === ConnectionStatus.Received || info.status === ConnectionStatus.Establishing) {
                    if (Date.now() > info.timestamp + (1000 * ConnectionEstablishmentTimeout)) {
                        toCleanUp.push(callId);

                        NetworkAgent.connLogger.trace(() => 'Cleaning up connection (establishment timeout reached): ' + info.connId + ', remote ep is ' + info.remoteEndpoint);
                    } 
                } else if (!conn.channelIsOperational()) {
                    toCleanUp.push(callId);

                    NetworkAgent.connLogger.trace(() => 'Cleaning up connection (channel is not operational): ' + info.connId + ', remote ep is ' + info.remoteEndpoint);
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

        if (proxyConfig?.linkupEventIngestFn !== undefined) {
            this.linkupManagerHost = new LinkupManagerHost(proxyConfig.linkupEventIngestFn, this.linkupManager);
        }

        if (proxyConfig?.webRTCCommandFn !== undefined) {
            this.connProxies = new Map();
            this.webRTCConnEventIngestFn = (ev: WebRTCConnectionEvent) => {
                const proxy = this.connProxies?.get(ev.connId);

                if (proxy === undefined) {
                    this.logger.warning('Receivd connection event for ' + ev.connId + ', but there is no registered proxy.');
                }

                proxy?.connectionEventIngestFn(ev);

                if (ev.type === 'connection-status-change' && ev.status === 'closed') {
                    this.connProxies?.delete(ev.connId);
                }
            };

        }


        /*
        this.worker = globalThis.process?.versions?.node === undefined && globalThis.document === undefined;

        if (this.worker) {

            const eventCallback = (ev: LinkupManagerEvent) => {
                (globalThis as any as ServiceWorker).postMessage(ev);
            }

            this.linkupManagerHost = new LinkupManagerProxyHost(eventCallback, this.linkupManager);
        
            const sendToWebRTCProxyHost = (cmd: WebRTCConnectionCommand) => {
                globalThis.postMessage(cmd);
            };

        }
        */

    }

    /*
    public linkupManagerHostCommand(cmd: LinkupManagerCommand) {
        this.linkupManagerHost?.execute(cmd);
    }

    public createWebRTCConnectionProxy() {
        globalThis.postMessage
    }
    */

    private acceptReceivedConnectionMessages(connId: ConnectionId, instanceId?: string, message?: any) {

        let messages = this.deferredInitialMessages.get(connId);

        if (messages === undefined) {
            messages = [];
        }

        if (message !== undefined && instanceId !== undefined) {
            messages.push({instanceId: instanceId, message: message});
        }

        
        for (const {message, instanceId } of messages) {
            let conn = this.connections.get(connId);

            if (conn === undefined) {
                let connInfo = this.connectionInfo.get(connId) as ConnectionInfo;
    
                if (connInfo !== undefined) {

                    const receiver = LinkupAddress.fromURL(connInfo.localEndpoint);
                    const sender   = LinkupAddress.fromURL(connInfo.remoteEndpoint);

                    if (SignallingServerConnection.isWebRTCBased(connInfo.remoteEndpoint)) {
                        if (SignallingServerConnection.isWebRTCBased(connInfo.localEndpoint)) {

                            if (this.proxyConfig?.webRTCCommandFn === undefined) {
                                conn = new WebRTCConnection(this.linkupManager, receiver, sender, connId, this.connectionReadyCallback);
                            } else {
                                const connProxy = new WebRTCConnectionProxy(receiver, sender, connId, this.connectionReadyCallback, this.proxyConfig?.webRTCCommandFn);
                                this.connProxies?.set(connId, connProxy);
                                conn = connProxy;
                            }
                            
                        } else {
                            conn = new WebSocketConnection(connId, receiver, sender, this.connectionReadyCallback);    
                        }
                    } else {
                        conn = new WebSocketConnection(connId, receiver, sender, this.connectionReadyCallback);
                    }
                    
                }

                if (conn instanceof WebRTCConnection || conn instanceof WebRTCConnectionProxy || conn instanceof WebSocketConnection) {
                    conn.setMessageCallback(this.messageCallback);
                    conn.answer(instanceId, message);
                }
            } else {
                if (conn instanceof WebRTCConnection || conn instanceof WebRTCConnectionProxy) {
                    conn.receiveSignallingMessage(instanceId, message);
                } else if (conn instanceof WebSocketConnection) {
                    conn.answer(instanceId, message);
                }
            }

            if (conn !== undefined) {
                this.connections.set(connId, conn);
            }
        }
    }

    private deferReceivedConnectionMessage(connId: ConnectionId, instanceId: string, message: any) {

        let messages = this.deferredInitialMessages.get(connId);

        if (messages === undefined) {
            messages = new Array<{instanceId: string, message: any}>();
            this.deferredInitialMessages.set(connId, messages);
        }

        messages.push({message: message, instanceId: instanceId});
    }

    // Network listen, shutdown

    listen(endpoint: Endpoint, identity?: Identity) {

        let address = LinkupAddress.fromURL(endpoint, identity);

        this.listening.add(endpoint);

        this.linkupManager.listenForQueryResponses(endpoint, (ep: string, addresses: Array<LinkupAddress>) => {

            if (this.listening.has(ep)) {
                this.connLogger.debug(ep + ' received listening notice of ' + addresses.map((l:LinkupAddress) => l.url()));
                for (const address of addresses) {

                    let ev: RemoteAddressListeningEvent = {
                        type: NetworkEventType.RemoteAddressListening,
                        content: {
                            remoteEndpoint: address.url()
                        }
                    };

                    this.pod?.broadcastEvent(ev);
                }
            } else {
                this.connLogger.debug('received wrongly addressed listenForQueryResponse message, was meant for ' + ep + ' which is not listening in this network node.');
            }

        });



        this.logger.debug('Listening for endpoint ' + endpoint);
        this.linkupManager.listenForMessagesNewCall(address, this.newConnectionRequestCallback);
    }

    listenForLinkupMessages(endpoint: Endpoint) {
        let address = LinkupAddress.fromURL(endpoint);
        this.linkupMessageListening.add(endpoint);
        this.linkupManager.listenForRawMessages(address, this.linkupMessageCallback);
    }

    //FIXME: remainder: do ws cleanup for not-yet-accepted connections here as well.
    shutdown() {
        this.linkupManager.shutdown();
        if (this.intervalRef !== undefined) {
            clearInterval(this.intervalRef);
            this.intervalRef = undefined;
        }  
        for (const conn of this.connections.values()) {
            this.connectionInfo.delete(conn.getConnectionId());
            this.connections.delete(conn.getConnectionId());
            conn.close();
        }
    }

    // Connection management: connect-disconnect, find out which addresses are online
    //                        at the moment, recover the endpoint for a current callId.

    connect(local: Endpoint, remote: Endpoint, requestedBy: AgentId) : ConnectionId {

        this.connLogger.debug(local + ' is asking for connection to ' + remote);

        const localAddress  = LinkupAddress.fromURL(local);
        const remoteAddress = LinkupAddress.fromURL(remote);

        const callId = new RNGImpl().randomHexString(BITS_FOR_CONN_ID);

        this.connectionInfo.set(
            callId, 
            { 
                localEndpoint: local, 
                remoteEndpoint: remote, 
                connId: callId, 
                status: ConnectionStatus.Establishing, 
                timestamp: Date.now(),
                requestedBy: new Set([requestedBy])
            });


        let conn: WebRTCConnection | WebRTCConnectionProxy | WebSocketConnection;

        if (SignallingServerConnection.isWebRTCBased(remoteAddress.url())) {
            if (SignallingServerConnection.isWebRTCBased(localAddress.url())) {
                if (this.proxyConfig?.webRTCCommandFn === undefined) {
                    conn = new WebRTCConnection(this.linkupManager, localAddress, remoteAddress, callId, this.connectionReadyCallback);
                } else {
                    const connProxy = new WebRTCConnectionProxy(localAddress, remoteAddress, callId, this.connectionReadyCallback, this.proxyConfig?.webRTCCommandFn);
                    this.connProxies?.set(callId, connProxy);
                    conn = connProxy;
                }    
            } else {
                conn = new WebSocketConnection(callId, localAddress, remoteAddress, this.connectionReadyCallback, this.linkupManager);
            }
        } else {
            conn = new WebSocketConnection(callId, localAddress, remoteAddress, this.connectionReadyCallback);
        }

        conn.setMessageCallback(this.messageCallback);

        this.connections.set(callId, conn);

        conn.open();

        return callId;
    }

    acceptConnection(connId: ConnectionId, requestedBy: AgentId) {

        let connInfo = this.connectionInfo.get(connId);

        if (connInfo === undefined) {
            throw new Error('Connection with id ' + connId + ' no longer exists (if it ever did).');
        }

        if (connInfo.status === ConnectionStatus.Received) {
            // FIRST set connection status to Establishing
            connInfo.status = ConnectionStatus.Establishing;
            // THEN invoke accept (since it may set status to something else, like Ready)
            this.acceptReceivedConnectionMessages(connId);
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

        this.connLogger.debug('connection ' + id + ' is being released by agent ' + requestedBy + ' on ' + connInfo?.localEndpoint);

        connInfo?.requestedBy.delete(requestedBy);

        if (connInfo?.requestedBy.size === 0) {

            this.connLogger.debug('connection ' + id + ' is no longer being used on ' + connInfo?.localEndpoint + ', closing');

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

        
        if (this.listening.has(source.url())) {
            this.connLogger.log(source.url() + ' asking if any is online: ' + targets.map((l: LinkupAddress) => l.url()), LogLevel.DEBUG);
            this.linkupManager.queryForListeningAddresses(source.url(), targets);
        } else {
            this.connLogger.error(source.url() + ' is querying for online addresses, but it is not listening on this network.');
            throw new Error('Looking for online targets for endpoint ' + source.url() + ' but that endpoint is not listening on this network.');
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

    connectionSendBufferIsEmpty(id: ConnectionId): boolean {
        const conn = this.connections.get(id);

        if (conn !== undefined) {
            return conn.bufferedAmount() === 0;
        } else {
            return false;
        }

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


    // Sends a cleartext message, even if no peer has been configured for that connection.
    // Meant to be used in peer authentication & set up.

    sendMessage(connId: ConnectionId, agentId: AgentId, content: any) {

        this.messageLogger.trace(() => 'Endpoint ' + this.connectionInfo.get(connId)?.localEndpoint + ' is sending message to ' + this.connectionInfo.get(connId)?.remoteEndpoint + ':\n' + JSON.stringify(content));

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

        if (this.testingMode) {
            const dice = Math.random();

            if (dice < 0.01) {
                // drop
            } else if (dice < 0.02) {
                // delay
                const delay = Math.random() * 5000;
                new Promise(r => setTimeout(r, delay)).then(() => { conn.send(JSON.stringify(message)); }).catch(() => {});
            } else if (dice < 0.03) {
                // truncate
                conn.send(JSON.stringify(message).substring(0, 100));
            } else {
                // send allright
                conn.send(JSON.stringify(message));
            }

            return;
        }

        conn.send(JSON.stringify(message));

    }

    sendLinkupMessage(sourceAddress: LinkupAddress, destinationAddress: LinkupAddress, agentId: AgentId, content: any, sendLimit?: number) {

        let linkupMessage: LinkupMessage = {
            source: sourceAddress.url(),
            destination: destinationAddress.url(),
            agentId: agentId,
            content: content
        };

        this.linkupManager.sendRawMessage(sourceAddress, destinationAddress, linkupMessage, sendLimit);
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

        this.pod?.broadcastEvent(ev);

        this.connectionInfo.delete(id);
        this.connections.delete(id);
        this.deferredInitialMessages.delete(id);


    }

    ready(pod: AgentPod): void {
        this.pod = pod;
        this.intervalRef = setInterval(this.tick, TickInterval * 1000);
    }

    receiveLocalEvent(ev: AgentEvent): void {
        ev;
    }

    private receiveMessage(msg: Message) {

        let ev: MessageReceivedEvent = {
            type: NetworkEventType.MessageReceived,
            content: msg
        };

        const agent = this.pod?.getAgent(msg.agentId);
        if (agent !== undefined) {
            agent.receiveLocalEvent(ev);
        }
    }
}

export { NetworkAgent, ConnectionId, NetworkEventType, RemoteAddressListeningEvent, ConnectionStatusChangeEvent, ConnectionStatus, MessageReceivedEvent, LinkupMessageReceivedEvent, LinkupMessage, Endpoint, NetworkAgentProxyConfig }