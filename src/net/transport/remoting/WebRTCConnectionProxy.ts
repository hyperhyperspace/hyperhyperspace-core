import { WebRTCConnectionCommand, CreateConnection, InformCallbackSet, CloseConnection, SendMessage } from './WebRTCConnectionProxyHost';
import { WebRTCConnectionEvent, ConnectionStatusChange, MessageReceived } from './WebRTCConnectionProxyHost';
import { LinkupAddress } from 'net/linkup/LinkupAddress';
import { Connection } from '../Connection';
/* functions that actually used:

new
getConnectionId
channelIsOperational
close
setMessageCallback
answer
receiveSignallingMessage

*/


class WebRTCConnectionProxy implements Connection {
    
    commandForwardingFn: (cmd: WebRTCConnectionCommand) => void

    localAddress: LinkupAddress;
    remoteAddress: LinkupAddress;
    initiator: boolean;
    callId: string;
    readyCallback : (conn: Connection) => void;
    messageCallback: ((data: any, conn: Connection) => void) | undefined;
    cachedChannelStatus : string;
    closed: boolean;

    connectionEventIngestFn: (ev: WebRTCConnectionEvent) => void;

    constructor(local: LinkupAddress, remote: LinkupAddress, callId: string, readyCallback : (conn: Connection) => void, commandForwardingFn: (cmd: WebRTCConnectionCommand) => void) {
        
        this.commandForwardingFn = commandForwardingFn;
        
        this.localAddress = local;
        this.remoteAddress = remote;
        this.initiator = false;
        this.callId = callId;
        this.readyCallback = readyCallback;
        this.cachedChannelStatus = 'unknown';
        this.closed = false;

        this.connectionEventIngestFn = (ev: WebRTCConnectionEvent) => {

            if (ev.connId === this.callId) {
                if (ev.type === 'connection-ready') {
                    
                    this.readyCallback(this);
                
                } else if (ev.type === 'connection-status-change') {
                    
                    const change = ev as ConnectionStatusChange;
                    this.cachedChannelStatus = change.status;

                } else if (ev.type === 'message-received') {
                    
                    const msg = ev as MessageReceived;

                    // this check should be unnecessary, because the WebRTCConnectionProvider
                    // won't start forwarding messages until it has been informed by this class
                    // that the messageCallback was installed.
                    if (this.messageCallback !== undefined) {
                        this.messageCallback(msg.data, this);
                    }
                    
                }
            }

        };

        const msg: CreateConnection = {
            type: 'create-connection',
            connId: callId,
            localEndpoint: local.url(),
            remoteEndpoint: remote.url()
        }

        this.commandForwardingFn(msg);


    }
    
    getConnectionId(): string {
        return this.callId;
    }

    initiatedLocally(): boolean {
        throw new Error('Method not implemented.');
    }

    setMessageCallback(messageCallback: (message: any, conn: Connection) => void): void {
        this.messageCallback = messageCallback;

        if (messageCallback !== undefined) {
            const msg: InformCallbackSet = {
                type: 'message-callback-set',
                connId: this.callId
            }

            this.commandForwardingFn(msg);
        }
    }

    // possible values: 'unknown', 'connecting', 'open', 'closed', 'closing';
    channelStatus() {
        return this.cachedChannelStatus;
    }


    channelIsOperational(): boolean {
        return this.cachedChannelStatus === 'open';
    }

    close(): void {
        this.closed = true;
        
        const cmd: CloseConnection = {
            type: 'close-connection',
            connId: this.callId
        };

        this.commandForwardingFn(cmd);
    }

    send(message: any): void {
        
        const cmd: SendMessage = {
            type: 'send-message',
            connId: this.callId,
            contents: message
        };

        this.commandForwardingFn(cmd);
    }

}

export { WebRTCConnectionProxy };