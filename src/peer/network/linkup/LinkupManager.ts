
import { LinkupAddress } from './LinkupAddress';
import { LinkupServerConnection, CallCallback, MessageCallback } from './LinkupServerConnection';

class LinkupManager {
    serverConnections : Map<string, LinkupServerConnection>;

    constructor() {
        this.serverConnections = new Map();
    }

    listenForMessagesNewCall(recipient: LinkupAddress, callback: CallCallback) : void {
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

    private getLinkupServerConnection(serverURL : string) : LinkupServerConnection {
        let serverConnection = this.serverConnections.get(serverURL);

        if (serverConnection === undefined) {
           serverConnection = new LinkupServerConnection(serverURL);
           this.serverConnections.set(serverURL, serverConnection); 
        }

        return serverConnection;
    }

}

export { LinkupManager };