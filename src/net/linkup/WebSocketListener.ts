/*import WebSocket  from 'ws';
import * as http from 'http';
*/
//import 'env/Environment';
import { LinkupServer, NewCallMessageCallback, MessageCallback, ListeningAddressesQueryCallback, RawMessageCallback } from './LinkupServer';
import { LinkupAddress } from './LinkupAddress';
import { LogLevel, Logger } from 'util/logging';
import { MultiMap } from 'util/multimap';


enum Params {
    CONN_ID     = 'connId',
    SENDER      = 'sender',
    RECIPIENT   = 'recipient',
    REVERSE     = 'reverse',
    INSTANCE_ID = 'instanceId'

}

interface WebSocketServer {
    onConnection: (ws: WebSocket, url: string) => void;
    close(): void;
}

class WebSocketListener implements LinkupServer {

    static logger = new Logger(WebSocketListener.name, LogLevel.INFO);


    static isAvailable() {
        return (global !== undefined && (global as any).WebSocketServerImpl !== undefined);
    }

    serverUrl: string;
    host: string;
    port: number;

    listener: WebSocketServer;
    
    newCallMessageCallbacks: MultiMap<string, NewCallMessageCallback>;

    onConnection: (socket: WebSocket, url: string) => void;
    
    constructor(serverUrl: string) {

        if (!WebSocketListener.isAvailable()) {
            throw new Error('WebSocketServer is not available in this platform');
        }

        let parsed = new URL(serverUrl);

        this.serverUrl = serverUrl;
        this.host = parsed.hostname;
        this.port = Number.parseInt(parsed.port);

        this.listener = new (global as any).WebSocketServerImpl({host: this.host, port: this.port}) as WebSocketServer;

        this.newCallMessageCallbacks = new MultiMap();

        this.onConnection = (socket: WebSocket, url: string) => {

            try {

                let parseOK = false;

                const parts = url.split('?');
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
                    const instanceId = params[Params.INSTANCE_ID];

                    if (recipient.serverURL === this.serverUrl) {
                        
                        let callbacks = this.newCallMessageCallbacks.get(recipient.linkupId);

                        if (callbacks.size > 0) {
                            for (const callback of callbacks) {
                                callback(sender, recipient, connId, instanceId, {ws: socket, reverse: reverse, remoteInstanceId: instanceId});
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
                    WebSocketListener.logger.error('Could not parse websocket request with url ' + url);
                    socket.close();
                }
            } catch (e) {
                WebSocketListener.logger.error('Error configuring websocket connection, url was: ' + url + ', error: ' + e);
                
                socket.close();
            }

            
        };

        this.listener.onConnection = this.onConnection;
    }

    getInstanceId() {
        return 'websocket-listener';
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

    listenForRawMessages(_recipient: LinkupAddress, _callback: RawMessageCallback): void {
        throw new Error("Listening for raw messages is not supported in WebSocket-listener based LinkupServers");
    }
    
    sendRawMessage(_sender: LinkupAddress, _recipient: LinkupAddress, _data: any, _sendLimit?: number): void {
        throw new Error("Sending raw messages is not supported in WebSocket-listener based LinkupServers");
    }

    close() {
        this.listener.close();
    }
}

export { WebSocketListener, Params };