
import { Endpoint } from 'mesh/agents/network';
import { MultiMap } from 'util/multimap';
import { LinkupAddress } from '../LinkupAddress';
import { QueryCallback } from '../LinkupManager';
import { MessageCallback, NewCallMessageCallback, RawMessageCallback } from '../LinkupServer';
import { LinkupManagerCommand, ListenForMessagesNewCall, ListenForMessagesOnCall, 
         ListenForRawMessages, SendMessageOnCall, SendRawMessage } from './LinkupManagerProxyHost';
import { ListenForQueryResponses, QueryForListeningAddresses } from './LinkupManagerProxyHost'; 
import { LinkupManagerEvent, NewCallMessageEvent, RawMessageEvent, 
         ListeningAddressesQueryEvent, MessageOnCallEvent } from './LinkupManagerProxyHost';

class LinkupManagerProxy {

    commandForwardingFn: (cmd: LinkupManagerCommand) => void

    messagesNewCallCallbacks: MultiMap<Endpoint, NewCallMessageCallback>;
    messagesOnCallCallbacks: MultiMap<string, MessageCallback>;
    rawMessageCallbacks: MultiMap<Endpoint, RawMessageCallback>;
    queryResponseCallbacks: MultiMap<string, QueryCallback>;

    linkupManagerEventIngestFn: (ev: LinkupManagerEvent) => void;

    constructor(commandForwardingFn: (cmd: LinkupManagerCommand) => void) {

        this.commandForwardingFn = commandForwardingFn;
        this.messagesNewCallCallbacks = new MultiMap();
        this.messagesOnCallCallbacks = new MultiMap();
        this.rawMessageCallbacks = new MultiMap();
        this.queryResponseCallbacks = new MultiMap();

        this.linkupManagerEventIngestFn = (ev: LinkupManagerEvent) => {
            
            if (ev.type === 'new-call-message') {
                const newCall = ev as NewCallMessageEvent;

                for (const cb of this.messagesNewCallCallbacks.get(newCall.recipient)) {

                    const sender = LinkupAddress.fromURL(newCall.sender);
                    const recipient = LinkupAddress.fromURL(newCall.recipient);

                    try {
                        cb(sender, recipient, newCall.callId, newCall.message);
                    } catch (e) {
                        console.log('Error in callback invocation within LinkupManagerProxy: ' + e);
                    }
                    
                }
            } else if (ev.type === 'raw-message-event') {
                const raw = ev as RawMessageEvent;

                for (const cb of this.rawMessageCallbacks.get(raw.recipient)) {

                    const sender = LinkupAddress.fromURL(raw.sender);
                    const recipient = LinkupAddress.fromURL(raw.recipient);

                    try {
                        cb(sender, recipient, raw.message);
                    } catch (e) {
                        console.log('Error in callback invocation within LinkupManagerProxy: ' + e);
                    }
                }

            } else if (ev.type === 'listening-addresses-query-response') {
                const response = ev as ListeningAddressesQueryEvent;

                for(const cb of this.queryResponseCallbacks.get(response.queryId)) {

                    const listening = response.matches.map((ep: Endpoint) => LinkupAddress.fromURL(ep)); 

                    try {
                        cb(response.queryId, listening);
                    } catch (e) {
                        console.log('Error in callback invocation within LinkupManagerProxy: ' + e);
                    }
                }

            } else if (ev.type === 'message-on-call') {
                const msg = ev as MessageOnCallEvent;

                
                for (const cb of this.messagesOnCallCallbacks.get(msg.recipient + '/' + msg.callId)) {

                    try {
                        cb(msg.message);
                    } catch (e) {
                        console.log('Error in callback invocation within LinkupManagerProxy: ' + e);
                    }
                }
            }
        }
    }

    listenForMessagesNewCall(recipient: LinkupAddress, callback: NewCallMessageCallback): void {
        
        const cmd: ListenForMessagesNewCall = {
            type: 'listen-for-messages-new-call',
            recipient: recipient.url()
        };

        this.messagesNewCallCallbacks.add(cmd.recipient, callback);

        this.commandForwardingFn(cmd);

    }

    listenForMessagesOnCall(recipient: LinkupAddress, callId: string, callback: MessageCallback): void {
    
        const cmd: ListenForMessagesOnCall = {
            type: 'listen-for-messages-on-call',
            recipient: recipient.url(),
            callId: callId
        };

        this.messagesOnCallCallbacks.add(cmd.recipient + '/' + callId, callback);

        this.commandForwardingFn(cmd)
    }

    listenForRawMessages(recipient: LinkupAddress, callback: RawMessageCallback): void {
        
        const cmd: ListenForRawMessages = {
            type: 'listen-for-raw-messages',
            recipient: recipient.url()
        };

        this.rawMessageCallbacks.add(cmd.recipient, callback);

        this.commandForwardingFn(cmd);
    }

    sendMessageOnCall(sender: LinkupAddress, recipient: LinkupAddress, callId: string, data: any): void {
        
        const cmd: SendMessageOnCall = {
            type: 'send-message-on-call',
            sender: sender.url(),
            recipient: recipient.url(),
            callId: callId, 
            data: data
        };
        
        this.commandForwardingFn(cmd);
    }

    sendRawMessage(sender: LinkupAddress, recipient: LinkupAddress, data: any, sendLimit?: number) {
        
        const cmd: SendRawMessage = {
            type: 'send-raw-message',
            sender: sender.url(),
            recipient: recipient.url(),
            data: data,
            sendLimit: sendLimit
        };

        this.commandForwardingFn(cmd);
    }

    listenForQueryResponses(queryId: string, callback: QueryCallback) {

        const cmd: ListenForQueryResponses = {
            type: 'listen-for-query-responses',
            queryId: queryId
        };

        this.queryResponseCallbacks.add(queryId, callback);

        this.commandForwardingFn(cmd);
    }

    queryForListeningAddresses(queryId: string, addresses: Array<LinkupAddress>) {
        
        const cmd: QueryForListeningAddresses = {
            type: 'query-for-listening-addresses',
            queryId: queryId,
            addresses: addresses.map((addr: LinkupAddress) => addr.url())
        }

        this.commandForwardingFn(cmd);
    }
}

export { LinkupManagerProxy };