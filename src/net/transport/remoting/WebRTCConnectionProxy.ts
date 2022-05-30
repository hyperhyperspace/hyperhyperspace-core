import { WebRTCConnectionCommand, CreateConnection, InformCallbackSet, OpenConnection, AnswerConnection, ReceiveSignalling, CloseConnection, SendMessage } from './WebRTCConnectionsHost';
import { WebRTCConnectionEvent, ConnectionStatusChange, MessageReceived, UpdateBufferedAmount } from './WebRTCConnectionsHost';
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
    lastKnownBufferedAmount: number;

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
        this.lastKnownBufferedAmount = 0;

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
                    } else {
                        console.log('WARNING: lost message due to missing callback in WebRTCConnectionProxy for ' + msg.connId);
                    }
                    
                } else if (ev.type === 'update-buffered-amount') {

                    const msg = ev as UpdateBufferedAmount;
                    this.lastKnownBufferedAmount = msg.bufferedAmount;

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
            const cmd: InformCallbackSet = {
                type: 'message-callback-set',
                connId: this.callId
            }

            this.commandForwardingFn(cmd);
        }
    }

    // possible values: 'unknown', 'connecting', 'open', 'closed', 'closing';
    channelStatus() {
        return this.cachedChannelStatus;
    }


    channelIsOperational(): boolean {
        return this.cachedChannelStatus === 'open';
    }

    open(channelName='mesh-network-channel') {
        const cmd: OpenConnection = {
            type: 'open-connection',
            connId: this.callId,
            channelName: channelName
        };

        this.commandForwardingFn(cmd);
    }

    answer(instanceId: string, message: any) {
        const cmd: AnswerConnection = {
            type: 'answer-connection',
            connId: this.callId,
            instanceId: instanceId,
            message: message
        };

        this.commandForwardingFn(cmd);
    }

    receiveSignallingMessage(instanceId: string, message: any) {
        const cmd: ReceiveSignalling = {
            type: 'receive-signalling',
            connId: this.callId,
            instanceId: instanceId,
            message: message
        };

        this.commandForwardingFn(cmd);
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

    bufferedAmount(): number {
        return this.lastKnownBufferedAmount;
    }

}

export { WebRTCConnectionProxy };