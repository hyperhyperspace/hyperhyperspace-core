import WebSocket  from 'ws';
import * as http from 'http';
import { LinkupServer, NewCallMessageCallback, MessageCallback, ListeningAddressesQueryCallback } from './LinkupServer';
import { LinkupAddress } from './LinkupAddress';
import { LogLevel, Logger } from 'util/logging';
import { MultiMap } from 'util/multimap';


enum Params {
    CONN_ID   = 'connId',
    SENDER    = 'sender',
    RECIPIENT = 'recipient',
    REVERSE   = 'reverse'

}

class WebSocketListener implements LinkupServer {

    static logger = new Logger(WebSocketListener.name, LogLevel.INFO);


    serverUrl: string;
    host: string;
    port: number;

    listener: WebSocket.Server;
    
    newCallMessageCallbacks: MultiMap<string, NewCallMessageCallback>;

    onConnection: (socket: WebSocket, request: http.IncomingMessage) => void;
    
    constructor(serverUrl: string) {

        let parsed = new URL(serverUrl);

        this.serverUrl = serverUrl;
        this.host = parsed.hostname;
        this.port = Number.parseInt(parsed.port);

        this.listener = new WebSocket.Server({host: this.host, port: this.port});

        this.newCallMessageCallbacks = new MultiMap();

        this.onConnection = (socket: WebSocket, request: http.IncomingMessage) => {

            try {

                let parseOK = false;

                const parts = request.url?.split('?');
                const params: any = {};
                if (parts !== undefined && parts.length === 2) {
                    for (const param of parts[1].split('&')) {
                        const d = param.split('=');
                        if (d.length > 0) {
                            const key = d[0];
                            const value = d.length > 1? decodeURIComponent(d[1]) : undefined;
                            params[key] = value;
                        }
                    }
                }
    
                if (params[Params.CONN_ID]   !== undefined && 
                    params[Params.SENDER]    !== undefined && 
                    params[Params.RECIPIENT] !== undefined) {
                    const connId = decodeURIComponent(params[Params.CONN_ID]);
                    const sender  = LinkupAddress.fromURL(decodeURIComponent(params[Params.SENDER]));
                    const recipient = LinkupAddress.fromURL(decodeURIComponent(params[Params.RECIPIENT]));
                    const reverse   = params[Params.REVERSE];

                    if (recipient.serverURL === this.serverUrl) {
                        
                        let callbacks = this.newCallMessageCallbacks.get(recipient.linkupId);

                        if (callbacks.size > 0) {
                            for (const callback of callbacks) {
                                callback(sender, recipient, connId, {ws: socket, reverse: reverse});
                                parseOK = true;
                            }
                        } else {
                            WebSocketListener.logger.debug('Received websocket request for linkupId ' + recipient.linkupId + ' but there are no registered listeners for it.');
                        }
                        
                    } else {
                        WebSocketListener.logger.warning('Received websocket request for server ' + recipient.serverURL + ', but this is ' + this.serverUrl + ', rejecting.');
                    }
                }
                
                if (!parseOK) {
                    WebSocketListener.logger.error('Could not parse websocket request with url ' + request?.url);
                    socket.close();
                }
            } catch (e) {
                WebSocketListener.logger.error('Error configuring websocket connection, url was: ' + request?.url + ', error: ' + e);
                
                socket.close();
            }

            
        };

        this.listener.on('connection', this.onConnection);
    }
    
    listenForMessagesNewCall(recipient: LinkupAddress, callback: NewCallMessageCallback): void {
        if (recipient.serverURL !== this.serverUrl) {
            throw new Error('Asked to listen for connections for server ' + recipient.serverURL + ' but this is ' + this.serverUrl);
        }

        this.newCallMessageCallbacks.add(recipient.linkupId, callback);
    }
    
    listenForMessagesOnCall(_recipient: LinkupAddress, _callId: string, _callback: MessageCallback): void {
        throw new Error("WebSocket-based connections don't need out-of-band connection establishment messages, and they are not supported. Just use the connection messaging methods!");
    }
    
    listenForLinkupAddressQueries(_callback: ListeningAddressesQueryCallback): void {
        throw new Error("Listening address queries are not supported on plain websocket listeners, just try to connect and see if it works.");
    }

    sendMessage(_sender: LinkupAddress, _recipient: LinkupAddress, _callId: string, _data: any): void {
        throw new Error("WebSocket-based connections don't need out-of-band connection establishment messages, and they are not supported. Just use the connection messaging methods!");
    }
    
    sendListeningAddressesQuery(_queryId: string, _addresses: import("./LinkupAddress").LinkupAddress[]): void {
        throw new Error("Listening address queries are not supported on plain websocket listeners, just try to connect and see if it works.");
    }

    close() {
        this.listener.close();
    }
}

export { WebSocketListener, Params };