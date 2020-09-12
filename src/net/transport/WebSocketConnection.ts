import { Connection } from './Connection';
import { LinkupAddress } from 'net/linkup/LinkupAddress';
import { Params } from '../linkup/LinkupServerListener';




class WebSocketConnection implements Connection {

    connectionId: string;

    localAddress: LinkupAddress;
    remoteAddress: LinkupAddress;

    ws?: WebSocket;    

    initiated: boolean;

    incomingMessages : any[];

    readyCallback : (conn: Connection) => void;
    messageCallback: ((data: any, conn: Connection) => void) | undefined;

    onmessage : (ev: MessageEvent) => void;
    onopen : () => void;

    constructor(connectionId: string, localAddress: LinkupAddress, remoteAddress: LinkupAddress, readyCallback : (conn: Connection) => void) {

        this.connectionId = connectionId;

        this.localAddress = localAddress;
        this.remoteAddress = remoteAddress;

        this.readyCallback = readyCallback;
        this.initiated = false;

        this.incomingMessages = [];

        this.onmessage = (ev) => {
            //WebRTCConnection.logger.debug(this.localAddress?.linkupId + ' received message from ' + this.remoteAddress?.linkupId + ' on call ' + this.callId);
            //WebRTCConnection.logger.trace('message is ' + ev.data);
            if (this.messageCallback != null) {
                this.messageCallback(ev.data, this);
            } else {
                this.incomingMessages.push(ev);
            }
        };

        this.onopen = () => {
            //WebRTCConnection.logger.debug('connection from ' + this.localAddress?.linkupId + ' to ' + this.remoteAddress?.linkupId + ' is ready for call ' + this.callId);
            this.readyCallback(this);
        };
    }

    open() {
        this.initiated = true;

        this.ws = new WebSocket(this.remoteAddress.url() + '?' + 
                        Params.CONN_ID + '=' + encodeURIComponent(this.connectionId) + '&' + 
                        Params.SENDER  + '=' + encodeURIComponent(this.localAddress.url()) + '&' +
                        Params.RECIPIENT + '=' + encodeURIComponent(this.remoteAddress.url()));
        
        this.ws.onopen    = this.onopen;
        this.ws.onmessage = this.onmessage;
    }

    answer(message: any) {
        this.initiated = false;
        this.ws = message.ws as WebSocket;
        this.ws.onmessage = this.onmessage;
        this.readyCallback(this);
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
        this.ws?.send(message);
    }

}

export { WebSocketConnection };