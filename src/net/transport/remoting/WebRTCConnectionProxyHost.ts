import { Endpoint } from 'mesh/agents/network';
import { LinkupAddress } from 'net/linkup/LinkupAddress';
import { LinkupManager } from 'net/linkup/LinkupManager';
import { Connection } from '../Connection';
import { WebRTCConnection } from '../WebRTCConnection';

type WebRTCConnectionCommand = CreateConnection | InformCallbackSet | CloseConnection | SendMessage;

type CreateConnection = {
    type: 'create-connection',
    localEndpoint: Endpoint,
    remoteEndpoint: Endpoint,
    connId: string
}

type InformCallbackSet = {
    type: 'message-callback-set',
    connId: string
}

type CloseConnection = {
    type: 'close-connection',
    connId: string
}

type SendMessage = {
    type: 'send-message',
    connId: string, 
    contents: any
}

type WebRTCConnectionEvent = ConnectionReady | ConnectionStatusChange | MessageReceived;

type ConnectionReady = {
    type: 'connection-ready',
    connId: string
}

type ConnectionStatusChange = {
    type: 'connection-status-change',
    connId: string,
    status: string
}

type MessageReceived = {
    type: 'message-received',
    connId: string;
    data: any;
}


class WebRTCConnectionProxyHost {

    connections: Map<string, WebRTCConnection>;
    linkup: LinkupManager;

    eventCallback: (ev: WebRTCConnectionEvent) => void;
    messageCallback: ((data: any, conn: Connection) => void);
    connectionReadyCallback: (conn: Connection) => void;
    connectionStatusChangeCallback: (status: string, conn: Connection) => void;


    constructor(eventCallback: (ev: WebRTCConnectionEvent) => void, linkup?: LinkupManager) {
        this.connections = new Map();
        this.linkup = linkup || new LinkupManager();

        this.eventCallback = eventCallback;

        this.messageCallback = (data: any, conn: Connection) => {
            let ev: MessageReceived = {
                type: 'message-received',
                connId: conn.getConnectionId(),
                data: data
            }

            this.eventCallback(ev);
        };

        this.connectionReadyCallback = (conn: Connection) => {
            let ev: ConnectionReady = {
                type: 'connection-ready',
                connId: conn.getConnectionId()
            };

            this.eventCallback(ev);
        };

        this.connectionStatusChangeCallback = (status: string, conn: Connection) => {
            let ev: ConnectionStatusChange = {
                type: 'connection-status-change',
                connId: conn.getConnectionId(),
                status: status
            };

            this.eventCallback(ev);
        };

    }

    execute(msg: WebRTCConnectionCommand) {

        if (msg.type === 'create-connection') { 

            const create = msg as CreateConnection;
            
            const local = LinkupAddress.fromURL(create.localEndpoint);
            const remote = LinkupAddress.fromURL(create.remoteEndpoint);
            const callId = create.connId;

            const conn = new WebRTCConnection(this.linkup, local, remote, callId, this.connectionReadyCallback, this.connectionStatusChangeCallback);
            this.connections.set(callId, conn);

        } else if (msg.type === 'message-callback-set') {

            this.connections.get(msg.connId)?.setMessageCallback(this.messageCallback);
        
        } else if (msg.type === 'close-connection') {

            this.connections.get(msg.connId)?.close();
            this.connections.delete(msg.connId);

        } else if (msg.type === 'send-message') {

            this.connections.get(msg.connId)?.send(msg.contents);

        }

    }

}

export { WebRTCConnectionProxyHost, WebRTCConnectionCommand, CreateConnection, InformCallbackSet, CloseConnection, SendMessage, WebRTCConnectionEvent, MessageReceived, ConnectionReady, ConnectionStatusChange };