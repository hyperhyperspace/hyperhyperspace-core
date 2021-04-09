import { Endpoint } from 'mesh/agents/network';
import { LinkupAddress } from 'net/linkup/LinkupAddress';
import { LinkupManager } from 'net/linkup/LinkupManager';
import { Connection } from '../Connection';
import { WebRTCConnection } from '../WebRTCConnection';

type WebRTCConnectionCommand = CreateConnection | InformCallbackSet | OpenConnection | AnswerConnection | ReceiveSignalling | CloseConnection | SendMessage;

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

type OpenConnection = {
    type: 'open-connection',
    connId: string,
    channelName: string
}

type AnswerConnection = {
    type: 'answer-connection',
    connId: string,
    message: any
}

type ReceiveSignalling = {
    type: 'receive-signalling',
    connId: string,
    message: any
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

type UpdateBufferedAmount = {
    type: 'update-buffered-amount',
    connId: string,
    bufferedAmount: number
}

type WebRTCConnectionEvent = ConnectionReady | ConnectionStatusChange | MessageReceived | UpdateBufferedAmount;

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


class WebRTCConnectionsHost {

    static isEvent(msg: any) {
        const type = msg?.type;

        return (type === 'connection-ready' || 
                type === 'connection-status-change' || 
                type === 'message-received' ||
                type === 'update-buffered-amount')
    }

    static isCommand(msg: any): boolean {
        const type = msg?.type;

        return (type === 'create-connection' || 
                type === 'message-callback-set' ||
                type === 'open-connection' ||
                type === 'answer-connection' ||
                type === 'receive-signalling' ||
                type === 'close-connection' ||
                type === 'send-message');
    }

    connections: Map<string, WebRTCConnection>;
    linkup: LinkupManager;

    eventCallback: (ev: WebRTCConnectionEvent) => void;
    messageCallback: ((data: any, conn: Connection) => void);
    connectionReadyCallback: (conn: Connection) => void;
    connectionStatusChangeCallback: (status: string, conn: Connection) => void;
    emptyBufferCallback: (conn: Connection) => void;


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

        this.emptyBufferCallback = (conn: Connection) => {
            let ev: UpdateBufferedAmount = {
                type: 'update-buffered-amount',
                connId: conn.getConnectionId(),
                bufferedAmount: conn.bufferedAmount()
            }

            this.eventCallback(ev);
        }

    }

    execute(cmd: WebRTCConnectionCommand) {

        if (cmd.type === 'create-connection') { 
            
            const create = cmd as CreateConnection;
            
            const local = LinkupAddress.fromURL(create.localEndpoint);
            const remote = LinkupAddress.fromURL(create.remoteEndpoint);
            const callId = create.connId;

            if (!this.connections.has(callId)) {
                const conn = new WebRTCConnection(this.linkup, local, remote, callId, this.connectionReadyCallback, this.connectionStatusChangeCallback);
                this.connections.set(callId, conn);                    
            }


        } else if (cmd.type === 'message-callback-set') {

            this.connections.get(cmd.connId)?.setMessageCallback(this.messageCallback);
        
        } else if (cmd.type === 'open-connection') {

            this.connections.get(cmd.connId)?.open(cmd.channelName)

        } else if (cmd.type === 'answer-connection') { 

            this.connections.get(cmd.connId)?.answer(cmd.message);

        } else if (cmd.type === 'receive-signalling') { 

            this.connections.get(cmd.connId)?.receiveSignallingMessage(cmd.message);

        } else if (cmd.type === 'close-connection') {

            this.connections.get(cmd.connId)?.close();
            this.connections.delete(cmd.connId);

        } else if (cmd.type === 'send-message') {

            if (!this.connections.has(cmd.connId)) {
                console.log('WARNING: trying to send message on ' + cmd.connId + ', but there is no such connection.');
            }

            const conn = this.connections.get(cmd.connId);
            if (conn !== undefined) {
                conn.send(cmd.contents);
                const ev: UpdateBufferedAmount = {
                    type: 'update-buffered-amount',
                    connId: cmd.connId,
                    bufferedAmount: conn.bufferedAmount()
                }
                this.eventCallback(ev);
            }
            

        }

    }

}

export { WebRTCConnectionsHost, WebRTCConnectionCommand, CreateConnection, InformCallbackSet, OpenConnection, AnswerConnection, ReceiveSignalling, CloseConnection, SendMessage, WebRTCConnectionEvent, MessageReceived, ConnectionReady, ConnectionStatusChange, UpdateBufferedAmount };