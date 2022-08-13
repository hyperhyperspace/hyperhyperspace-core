import { Connection } from './Connection';
import { LinkupAddress } from 'net/linkup/LinkupAddress';
import { Params } from '../linkup/WebSocketListener';
import { LinkupManager } from 'net/linkup/LinkupManager';
import { SignallingServerConnection } from 'net/linkup/SignallingServerConnection';
import { Logger, LogLevel } from 'util/logging';




class WebSocketConnection implements Connection {

    static logger = new Logger(WebSocketConnection.name, LogLevel.INFO);

    linkupManager?: LinkupManager;

    connectionId: string;

    localAddress: LinkupAddress;
    remoteAddress: LinkupAddress;

    remoteInstanceId?: string;

    ws?: WebSocket;    

    initiated: boolean;
    reverse: boolean;

    incomingMessages : any[];

    readyCallback : (conn: Connection) => void;
    messageCallback: ((data: any, conn: Connection) => void) | undefined;

    onmessage : (ev: MessageEvent) => void;
    onopen : () => void;

    constructor(connectionId: string, localAddress: LinkupAddress, remoteAddress: LinkupAddress, readyCallback : (conn: Connection) => void, linkupManager?: LinkupManager) {

        this.linkupManager = linkupManager;

        this.localAddress = localAddress;
        this.remoteAddress = remoteAddress;

        this.connectionId = connectionId;

        this.readyCallback = readyCallback;
        this.initiated = false;
        this.reverse   = false;

        this.incomingMessages = [];

        this.onmessage = (ev) => {
            WebSocketConnection.logger.debug(this.localAddress?.linkupId + ' received message from ' + this.remoteAddress?.linkupId + ' on call ' + this.connectionId);
            WebSocketConnection.logger.trace('message is ' + ev.data);
            if (this.messageCallback != null) {
                this.messageCallback(ev.data, this);
            } else {
                this.incomingMessages.push(ev);
            }
        };

        this.onopen = () => {
            WebSocketConnection.logger.debug('connection from ' + this.localAddress?.linkupId + ' to ' + this.remoteAddress?.linkupId + ' is ready for call ' + this.connectionId);
            this.readyCallback(this);
        };

        //this.remoteInstanceId = 'websocket-listener';
    }

    open() {
        this.initiated = true;
        if (SignallingServerConnection.isWebRTCBased(this.remoteAddress.url())) {
            if (this.linkupManager !== undefined) {
                this.reverse = true;
                this.linkupManager.sendMessageOnCall(this.localAddress, this.remoteAddress, this.connectionId, { reverseconnection: 'true' });
                WebSocketConnection.logger.trace(() => 'Starting reverse connection cycle from ' + this.localAddress.url() + ' to ' + this.remoteAddress.url());
            } else {
                WebSocketConnection.logger.warning(() => 'Trying to connect to ' + this.remoteAddress.url() + ' form a websocket connection, but no linkupServer was provided. This is not possible - ignoring.');
            }
        } else {
            this.remoteInstanceId = 'websocket-listener';
            this.createWebsocket();
            
            WebSocketConnection.logger.trace('Starting websocket connection from ' + this.localAddress.url() + ' to ' + this.remoteAddress.url());
        }
        
    }

    private createWebsocket(reverse=false) {

        this.ws = new WebSocket(this.remoteAddress.url() + '?' + 
        Params.CONN_ID + '=' + encodeURIComponent(this.connectionId) + '&' + 
        Params.SENDER  + '=' + encodeURIComponent(this.localAddress.url()) + '&' +
        Params.RECIPIENT + '=' + encodeURIComponent(this.remoteAddress.url()) + 
        (reverse? '&' + Params.REVERSE + '=true' : '') + 
        (reverse? '&' + Params.INSTANCE_ID + '=' + encodeURIComponent((this.linkupManager as LinkupManager).getInstanceIdForAddress(this.localAddress)) : ''));

        this.ws.onopen    = this.onopen;
        this.ws.onmessage = this.onmessage;
    }

    answer(instanceId: string, message: any) {

        /*if (instanceId === undefined) {
            instanceId = 'websocket-listener';
        }

        if (this.remoteInstanceId === undefined) {
            if (instanceId !== undefined) {
                this.remoteInstanceId = instanceId;
            } else {
                this.remoteInstanceId = 'websocket-listener';
            }                
        }*/

        if (this.ws === undefined) {

            if (/*!this.reverse &&*/
                SignallingServerConnection.isWebRTCBased(this.localAddress.url()) && 
                message.reverseconnection !== undefined &&
                message.reverseconnection === 'true') {
                    WebSocketConnection.logger.trace(() => 'Creating websocket to ' + this.remoteAddress.url() + ' for reverse connection');
                    this.reverse = true;
                    this.initiated = false;
                    this.remoteInstanceId = message.remoteInstanceId;
                    this.createWebsocket(true);
            } else if (message.ws !== undefined) {
                this.ws = message.ws as WebSocket;
                this.ws.onmessage = this.onmessage;
                if (!this.reverse) {
                    this.initiated = false;
                    this.remoteInstanceId = 'websocket-listener';
                    WebSocketConnection.logger.trace(() => 'Received websocket connection from ' + this.remoteAddress.url());
                } else {
                    this.remoteInstanceId = instanceId;
                    WebSocketConnection.logger.trace(() => 'Received reverse websocket connection back at origin');
                }
                this.readyCallback(this);
            }
        }
    }


    getConnectionId(): string {
        return this.connectionId;
    }
    
    initiatedLocally(): boolean {
        return this.initiated;
    }

    setMessageCallback(messageCallback: (message: any, conn: Connection) => void): void {
        this.messageCallback = messageCallback;

        if (messageCallback != null) {
            while (this.incomingMessages.length > 0) {
                var ev = this.incomingMessages.shift();
                messageCallback(ev.data, this);
            }
        }
    }
    channelIsOperational(): boolean {
        return this.ws !== undefined && this.ws.readyState === WebSocket.OPEN;
    }

    close(): void {
        this.ws?.close();
    }

    send(message: any): void {

        if (this.ws === undefined) {
            throw new Error('Trying to send a message through a websocket that is not yet ready.')
        }

        this.ws.send(message);

        if (this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Error while trying to send a message through WebSocket');
        }
    }

    bufferedAmount(): number {

        if (this.ws !== undefined) {
            return this.ws?.bufferedAmount;
        } else {
            return 0;
        }
    }

}

export { WebSocketConnection };