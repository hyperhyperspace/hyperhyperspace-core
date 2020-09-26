
import { LinkupAddress } from './LinkupAddress';
import { SignallingServerConnection } from './SignallingServerConnection';
import { LinkupServer, NewCallMessageCallback, MessageCallback, ListeningAddressesQueryCallback } from './LinkupServer';
import { WebSocketListener } from './WebSocketListener';
import { Logger, LogLevel } from 'util/logging';

type QueryCallback = (queryId: string, listening: Array<LinkupAddress>) => void;

class LinkupManager {

    static logger = new Logger(LinkupManager.name, LogLevel.INFO);

    static defaultLinkupServer =  'wrtc+wss://mypeer.net:443';//'wrtc+ws://localhost:3002';

    serverConnections : Map<string, LinkupServer>;

    serverQueryCallback : ListeningAddressesQueryCallback;

    queryCallbacks : Map<string, QueryCallback>;

    constructor() {
        this.serverConnections = new Map();
        this.queryCallbacks    = new Map();

        this.serverQueryCallback = (queryId: string, matches: Array<LinkupAddress>) => {
            let queryCallback = this.queryCallbacks.get(queryId);

            if (queryCallback !== undefined) {
                queryCallback(queryId, matches);
            }
        }

    }

    listenForMessagesNewCall(recipient: LinkupAddress, callback: NewCallMessageCallback) : void {
        let connection = this.getLinkupServer(recipient.serverURL);

        connection.listenForMessagesNewCall(recipient, callback);
    }

    listenForMessagesOnCall(recipient: LinkupAddress, callId: string, callback: MessageCallback ) {
        let connection = this.getLinkupServer(recipient.serverURL);

        connection.listenForMessagesOnCall(recipient, callId, callback);
    }

    sendMessageOnCall(sender: LinkupAddress, recipient: LinkupAddress, callId: string, data: any) {
        let connection = this.getLinkupServer(recipient.serverURL);
        
        connection.sendMessage(sender, recipient, callId, data);
    }

    listenForQueryResponses(queryId: string, callback: QueryCallback) {
        this.queryCallbacks.set(queryId, callback);
    }

    queryForListeningAddresses(queryId: string, addresses: Array<LinkupAddress>) {
        let queries = new Map<string, Array<LinkupAddress>>();
        let direct: LinkupAddress[]  = [];

        for (const address of addresses) {
            if (SignallingServerConnection.isWebRTCBased(address.serverURL)) {
                let q = queries.get(address.serverURL);
                if (q === undefined) {
                    q = new Array<LinkupAddress>();
                    queries.set(address.serverURL, q);
                }
                q.push(address);
            } else {
                direct.push(address)
            }
        }

        for (const [serverURL, addresses] of queries.entries()) {
            let serverConnection = this.getLinkupServer(serverURL);

            LinkupManager.logger.trace(() => 'Sending query for listening addresses to ' + serverURL + ' for ' + addresses);
            serverConnection.sendListeningAddressesQuery(queryId, addresses);
        }

        const callback = this.queryCallbacks.get(queryId);

        if (callback !== undefined && direct.length > 0) {
            LinkupManager.logger.trace(() => 'Reporting websocket addresses as listening:' + JSON.stringify(direct));
            callback(queryId, direct);
        }
    }

    private getLinkupServer(serverURL : string) : LinkupServer {
        let serverConnection = this.serverConnections.get(serverURL);

        if (serverConnection === undefined) {
            if (SignallingServerConnection.isWebRTCBased(serverURL)) {
                serverConnection = new SignallingServerConnection(serverURL);
                serverConnection.listenForLinkupAddressQueries(this.serverQueryCallback);
            } else {
                serverConnection = new WebSocketListener(serverURL);
            }

            this.serverConnections.set(serverURL, serverConnection);
        }

        return serverConnection;
    }

    shutdown() {
        for (const serverConn of this.serverConnections.values()) {
            serverConn.close();
        }
    }

}

export { LinkupManager, QueryCallback };