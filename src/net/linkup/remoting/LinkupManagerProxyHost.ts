import { Endpoint } from 'mesh/agents/network';
import { LinkupAddress } from '../LinkupAddress';
import { LinkupManager } from '../LinkupManager';
import { MessageCallback, NewCallMessageCallback, RawMessageCallback, ListeningAddressesQueryCallback } from '../LinkupServer';


type LinkupManagerCommand = ListenForMessagesNewCall | ListenForMessagesOnCall | 
    ListenForRawMessages | SendMessageOnCall | SendRawMessage | 
    ListenForQueryResponses | QueryForListeningAddresses;

type ListenForMessagesNewCall = {
    type: 'listen-for-messages-new-call',
    recipient: Endpoint
    
}

type ListenForMessagesOnCall = {
    type: 'listen-for-messages-on-call',
    recipient: Endpoint,
    callId: string
}

type ListenForRawMessages = {
    type: 'listen-for-raw-messages',
    recipient: Endpoint
}

type SendMessageOnCall = {
    type: 'send-message-on-call',
    sender: Endpoint, 
    recipient: Endpoint, 
    callId: string, 
    data: any
}

type SendRawMessage = {
    type: 'send-raw-message',
    sender: Endpoint, 
    recipient: Endpoint, 
    data: any, 
    sendLimit?: number
}

type ListenForQueryResponses = {
    type: 'listen-for-query-responses',
    queryId: string
}

type QueryForListeningAddresses = {
    type: 'query-for-listening-addresses',
    queryId: string,
    addresses: Array<Endpoint>
}

type LinkupManagerEvent = NewCallMessageEvent | RawMessageEvent | 
    ListeningAddressesQueryEvent | MessageOnCallEvent;

type NewCallMessageEvent = {
    type: 'new-call-message',
    sender: Endpoint,
    recipient: Endpoint,
    callId: string,
    message: any
}

type RawMessageEvent = {
    type: 'raw-message-event',
    sender: Endpoint,
    recipient: Endpoint,
    message: any
}

type ListeningAddressesQueryEvent = {
    type: 'listening-addresses-query-response',
    queryId: string, 
    matches: Array<Endpoint>
}

type MessageOnCallEvent = {
    type: 'message-on-call',
    recipient: Endpoint,
    callId: string,
    message: any
}

class LinkupManagerProxyHost {

    linkup: LinkupManager;

    eventCallback: (ev: LinkupManagerEvent) => void;

    newCallMessageCallback: NewCallMessageCallback;
    messageCallabcks: Map<Endpoint, MessageCallback>;
    rawMessageCallback: RawMessageCallback;
    listeningAddressesQueryCallback: ListeningAddressesQueryCallback;

    constructor(eventCallback: (ev: LinkupManagerEvent) => void, linkup?: LinkupManager) {

        this.linkup = linkup || new LinkupManager();

        this.eventCallback = eventCallback;

        this.newCallMessageCallback = 
            (sender: LinkupAddress, recipient: LinkupAddress, callId: string, message: any) => {

                const ev: NewCallMessageEvent = {
                    type: 'new-call-message',
                    sender: sender.url(),
                    recipient: recipient.url(),
                    callId: callId,
                    message: message
                }

                this.eventCallback(ev);

        };

        this.messageCallabcks = new Map();

        this.rawMessageCallback = (sender: LinkupAddress, recipient: LinkupAddress, message: any) => {

            const ev: RawMessageEvent = {
                type: 'raw-message-event',
                sender: sender.url(),
                recipient: recipient.url(),
                message: message
            };

            this.eventCallback(ev);
        };

        this.listeningAddressesQueryCallback = (queryId: string, matches: Array<LinkupAddress>) => {

            const ev: ListeningAddressesQueryEvent = {
                type: 'listening-addresses-query-response',
                queryId: queryId,
                matches: matches.map((addr: LinkupAddress) => addr.url())
            };

            this.eventCallback(ev);
        };
    }

    execute(cmd: LinkupManagerCommand) {

        if (cmd.type === 'listen-for-messages-new-call') {

            const listen = cmd as ListenForMessagesNewCall;

            this.linkup.listenForMessagesNewCall(LinkupAddress.fromURL(listen.recipient), this.newCallMessageCallback);

        } else if (cmd.type === 'listen-for-messages-on-call') {

            const listen = cmd as ListenForMessagesOnCall;

            const callback = (msg: any) => {
                const ev: MessageOnCallEvent = {
                    type: 'message-on-call',
                    recipient: listen.recipient,
                    callId: listen.callId,
                    message: msg
                };

                this.eventCallback(ev);
            };

            this.linkup.listenForMessagesOnCall(LinkupAddress.fromURL(listen.recipient), listen.callId, callback);

        } else if (cmd.type === 'listen-for-raw-messages') {

            const listen = cmd as ListenForRawMessages;

            this.linkup.listenForRawMessages(LinkupAddress.fromURL(listen.recipient), this.rawMessageCallback);

        } else if (cmd.type === 'send-message-on-call') {

            const send = cmd as SendMessageOnCall;

            const sender = LinkupAddress.fromURL(send.sender);
            const recipient = LinkupAddress.fromURL(send.recipient);

            this.linkup.sendMessageOnCall(sender, recipient, send.callId, send.data);

        } else if (cmd.type === 'send-raw-message') {

            const send = cmd as SendRawMessage;

            const sender = LinkupAddress.fromURL(send.sender);
            const recipient = LinkupAddress.fromURL(send.recipient);

            this.linkup.sendRawMessage(sender, recipient, send.data, send.sendLimit);

        } else if (cmd.type === 'listen-for-query-responses') {

            const listen = cmd as ListenForQueryResponses;

            this.linkup.listenForQueryResponses(listen.queryId, this.listeningAddressesQueryCallback);

        } else if (cmd.type === 'query-for-listening-addresses') {

            let query = cmd as QueryForListeningAddresses;

            this.linkup.queryForListeningAddresses(query.queryId, query.addresses.map((ep: Endpoint) => LinkupAddress.fromURL(ep)));
        }
    }

}

export { LinkupManagerProxyHost};
export { LinkupManagerCommand, ListenForMessagesNewCall, ListenForMessagesOnCall,
         ListenForRawMessages, SendMessageOnCall, SendRawMessage, 
         ListenForQueryResponses, QueryForListeningAddresses };
export { LinkupManagerEvent, NewCallMessageEvent, RawMessageEvent, 
         ListeningAddressesQueryEvent, MessageOnCallEvent };