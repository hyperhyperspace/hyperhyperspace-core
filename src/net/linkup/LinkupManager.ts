
import { LinkupAddress } from './LinkupAddress';
import { LinkupServerConnection, NewCallMessageCallback, MessageCallback, LinkupIdQueryCallback } from './LinkupServerConnection';

type QueryCallback = (queryId: string, listening: Array<LinkupAddress>) => void;

class LinkupManager {

    static defaultLinkupServer =  'wss://mypeer.net:443';

    serverConnections : Map<string, LinkupServerConnection>;

    serverQueryCallback : LinkupIdQueryCallback;

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
        let connection = this.getLinkupServerConnection(recipient.serverURL);

        connection.listenForMessagesNewCall(recipient, callback);
    }

    listenForMessagesOnCall(recipient: LinkupAddress, callId: string, callback: MessageCallback ) {
        let connection = this.getLinkupServerConnection(recipient.serverURL);

        connection.listenForMessagesOnCall(recipient, callId, callback);
    }

    sendMessageOnCall(sender: LinkupAddress, recipient: LinkupAddress, callId: string, data: any) {
        let connection = this.getLinkupServerConnection(recipient.serverURL);
        
        connection.sendMessage(sender, recipient, callId, data);
    }

    listenForQueryResponses(queryId: string, callback: QueryCallback) {
        this.queryCallbacks.set(queryId, callback);
    }

    queryForListeningAddresses(queryId: string, addresses: Array<LinkupAddress>) {
        let queries = new Map<string, Array<LinkupAddress>>();

        for (const address of addresses) {
            let q = queries.get(address.serverURL);
            if (q === undefined) {
                q = new Array<LinkupAddress>();
                queries.set(address.serverURL, q);
            }
            q.push(address);
        }

        for (const [serverURL, addresses] of queries.entries()) {
            let serverConnection = this.getLinkupServerConnection(serverURL);

            serverConnection.sendListeningAddressesQuery(queryId, addresses);
        }
    }

    private getLinkupServerConnection(serverURL : string) : LinkupServerConnection {
        let serverConnection = this.serverConnections.get(serverURL);

        if (serverConnection === undefined) {
           serverConnection = new LinkupServerConnection(serverURL);
           serverConnection.listenForLinkupAddressQueries(this.serverQueryCallback);
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