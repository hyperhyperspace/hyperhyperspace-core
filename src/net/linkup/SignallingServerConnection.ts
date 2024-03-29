import { Logger, LogLevel } from 'util/logging';

import { LinkupServer, RawMessageCallback, NewCallMessageCallback, MessageCallback, ListeningAddressesQueryCallback } from './LinkupServer';
import { LinkupAddress } from './LinkupAddress';
import { RNGImpl } from 'crypto/random';

const CONN_BACKOFF_TIME = 15000;

/*
 * On instanceIds: when connecting to a linkup server, the SignallingServerConnection class will
 *                 create a randm "instanceId" value. When several peers are listening for 
 *                 connections on the same endpoint (e.g. several devices owner by the same person) 
 *                 and another peer initiates a connection, each of these peers will include a
 *                 different instanceId. This enables the initiator to tell them appart in the
 *                 WebRTC signalling phase, and to choose if he wants to connect to just one of
 *                 them, a few, etc.
 */

type InstanceId = string;

class SignallingServerConnection implements LinkupServer {

    static logger = new Logger(SignallingServerConnection.name, LogLevel.ERROR);

    static WRTC_URL_PREFIX = 'wrtc+';

    static isWebRTCBased(serverURL: string) {
        return serverURL.startsWith(SignallingServerConnection.WRTC_URL_PREFIX);
    }

    static getRealServerURL(serverURL: string) {
        return serverURL.slice(SignallingServerConnection.WRTC_URL_PREFIX.length);
    }

    readonly serverURL  : string;
    readonly instanceId : InstanceId; // see note above

    ws : WebSocket | null;

    rawMessageCallbacks     : Map<string, Set<RawMessageCallback>>;
    newCallMessageCallbacks : Map<string, Set<NewCallMessageCallback>>;
    messageCallbacks        : Map<string, Map<string, Set<MessageCallback>>>;

    listeningAddressesQueryCallback? : ListeningAddressesQueryCallback;

    linkupIdsToListen   : Map<string, LinkupAddress>;

    messageQueue     : string[];

    lastConnectionAttempt?: number;

    challenge?: string;

    closed: boolean;

    checkReceptionInterval: any;

    lastReceivedMessageTimestamp?: number;

    constructor(serverURL : string) {

        if (!SignallingServerConnection.isWebRTCBased(serverURL)) {
            throw new Error('LinkupServerConnection expects a URL that starts with "' + SignallingServerConnection.WRTC_URL_PREFIX + '", bailing out.');
        }

        this.serverURL = serverURL;
        this.instanceId  = new RNGImpl().randomHexString(128);

        this.ws = null;

        this.rawMessageCallbacks     = new Map();
        this.newCallMessageCallbacks = new Map();
        this.messageCallbacks        = new Map();

        this.linkupIdsToListen = new Map();

        this.messageQueue = [];

        this.closed = false;

        this.checkWebsocket();

        const FIVE_MINUTES = 5 * 60 * 1000;
        const HALF_HOUR    = 30 * 60 * 1000;

        // If we don't receive anything from the singalling server for
        // 10 minutes straight, disconnect and re-connect just in case.
        this.checkReceptionInterval = setInterval(() => {

            const now = Date.now();

            if (!this.closed) {
                if (this.lastReceivedMessageTimestamp === undefined ||
                    now - this.lastReceivedMessageTimestamp >= HALF_HOUR) {
                        SignallingServerConnection.logger.debug('closing websocket to server ' + this.serverURL + ' due to lack of received messages, will try to re-open');
                        try {
                            this.ws?.close();
                        } finally {
                            this.checkWebsocket();
                        }

                } else if (now - this.lastReceivedMessageTimestamp >= FIVE_MINUTES) {
                        try {
                            SignallingServerConnection.logger.trace('sending ping to server ' + this.serverURL);
                            this.ws?.send(JSON.stringify({action: 'ping'}));
                        } catch(e) {
                            this.checkWebsocket();
                        }    
                }
            }
        }, FIVE_MINUTES);
    }
    
    getInstanceId() {
        return this.instanceId;
    }

    listenForMessagesNewCall(recipient: LinkupAddress, callback: NewCallMessageCallback) : void {

        if (recipient.serverURL !== this.serverURL) {
            let e = new Error('Trying to listen for calls to ' + 
                              recipient.serverURL + 
                              ' but this is a connection to ' +
                              this.serverURL);
            SignallingServerConnection.logger.error(e);
            throw e;
        }

        let recipientCallCallbacks = this.newCallMessageCallbacks.get(recipient.linkupId);

        if (recipientCallCallbacks === undefined) {
            recipientCallCallbacks = new Set();
            this.newCallMessageCallbacks.set(recipient.linkupId, recipientCallCallbacks);
        }

        recipientCallCallbacks.add(callback);

        this.setUpListenerIfNew(recipient);
    }

    listenForRawMessages(recipient: LinkupAddress, callback: (sender: LinkupAddress, recipient: LinkupAddress, message: any) => void): void {
        
        if (recipient.serverURL !== this.serverURL) {
            let e = new Error('Trying to listen for raw messages to server ' + 
                              recipient.serverURL + 
                              ' but this is a connection to ' +
                              this.serverURL);
            SignallingServerConnection.logger.error(e);
            throw e;
        }

        let recipientRawCallbacks = this.rawMessageCallbacks.get(recipient.linkupId);

        if (recipientRawCallbacks === undefined) {
            recipientRawCallbacks = new Set();
            this.rawMessageCallbacks.set(recipient.linkupId, recipientRawCallbacks);
        }

        recipientRawCallbacks.add(callback);
        
        this.setUpListenerIfNew(recipient);
    }

    listenForMessagesOnCall(recipient: LinkupAddress, callId: string, callback: MessageCallback) {

        if (recipient.serverURL !== this.serverURL) {
            let e = new Error('Trying to listen for messages to ' + 
                              recipient.serverURL + 
                              ' but this is a connection to ' +
                              this.serverURL);
            SignallingServerConnection.logger.error(e);
            throw e;
        }

        let linkupIdCalls = this.messageCallbacks.get(recipient.linkupId);

        if (linkupIdCalls === undefined) {
            linkupIdCalls = new Map();
            this.messageCallbacks.set(recipient.linkupId, linkupIdCalls);
        }

        let messageCallbacks = linkupIdCalls.get(callId);

        if (messageCallbacks === undefined) {
            messageCallbacks = new Set();
            linkupIdCalls.set(callId, messageCallbacks);
        }

        messageCallbacks.add(callback);

        this.setUpListenerIfNew(recipient);
    }

    listenForLinkupAddressQueries(callback: ListeningAddressesQueryCallback) {
        this.listeningAddressesQueryCallback = callback;
    }

    sendMessage(sender: LinkupAddress, recipient: LinkupAddress, callId: string, data: any) {

        if (recipient.serverURL !== this.serverURL) {
            let e = new Error('Trying to send a linkup message to ' + 
                              recipient.serverURL + 
                              ' but this is a connection to ' +
                              this.serverURL);
            SignallingServerConnection.logger.error(e);
            throw e;
        }

        var message = {
                    'action'         :  'send',
                    'linkupId'       :  recipient.linkupId,
                    'callId'         :  callId,
                    'instanceId'     :  this.instanceId,
                    'data'           :  data,
                    'replyServerUrl' :  sender.serverURL,
                    'replyLinkupId'  :  sender.linkupId,
                  };
        
        this.enqueueAndSend(JSON.stringify(message));
    }

    sendRawMessage(sender: LinkupAddress, recipient: LinkupAddress, data: any, sendLimit?: number): void {
        if (recipient.serverURL !== this.serverURL) {
            let e = new Error('Trying to send a linkup message to ' + 
                              recipient.serverURL + 
                              ' but this is a connection to ' +
                              this.serverURL);
            SignallingServerConnection.logger.error(e);
            throw e;
        }

        var message: any = {
                    'action'         :  'send',
                    'linkupId'       :  recipient.linkupId,
                    'raw'            :  'true',
                    'data'           :  data,
                    'replyServerUrl' :  sender.serverURL,
                    'replyLinkupId'  :  sender.linkupId,
                  };

        if (sendLimit !== undefined) {
            message['limit'] = sendLimit;
        }
        
        this.enqueueAndSend(JSON.stringify(message));
    }

    sendListeningAddressesQuery(queryId: string, addresses: Array<LinkupAddress>) {

        let linkupIds = new Array<string>();

        for (const address of addresses) {
            if (address.serverURL !== this.serverURL) {
                let e = new Error('Trying to send an address query for ' + 
                                  address.serverURL + 
                                  ' but this is a connection to ' +
                                  this.serverURL);
                SignallingServerConnection.logger.error(e);
                throw e;
            }

            linkupIds.push(address.linkupId);
        }
        
        var message = {
            'action'        : 'query',
            'linkupIds'     : linkupIds,
            'queryId' : queryId
        };

        this.enqueueAndSend(JSON.stringify(message));
    }

    private checkWebsocket() : boolean {

        if (!this.closed) {
            if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
                return true;
            } else {
                if ( (this.ws === null ||
                    (this.ws.readyState === WebSocket.CLOSING ||
                    this.ws.readyState === WebSocket.CLOSED))
                    &&
                    (this.lastConnectionAttempt === undefined ||
                    (Date.now() > this.lastConnectionAttempt + CONN_BACKOFF_TIME))     
                    ) {
                    
                    this.lastConnectionAttempt = Date.now();

                    SignallingServerConnection.logger.debug('creating websocket to server ' + this.serverURL);
                    try {
                        this.ws = new WebSocket(SignallingServerConnection.getRealServerURL(this.serverURL));
                    } catch (e: any) {
                        this.ws = null;
                        SignallingServerConnection.logger.warning('Unexpected error while creating websocket to signalling server ' + this.serverURL);
                        SignallingServerConnection.logger.error(e);
                    }
                    
                    if (this.ws !== null) {
        
                        this.ws.onmessage = (ev) => {

                            this.lastReceivedMessageTimestamp = Date.now();

                            const message = JSON.parse(ev.data);
                            const ws = this.ws as WebSocket;
                
                            if (message['action'] === 'ping') {
                                SignallingServerConnection.logger.trace('sending pong to ' + this.serverURL);
                                if (this.ws !== null && this.ws.readyState === this.ws.OPEN) {
                                    try {
                                        ws.send(JSON.stringify({'action' : 'pong'}));
                                    } catch (e: any) {
                                        SignallingServerConnection.logger.warning('Error while sending pong to ' + this.serverURL, e);
                                    }
                                } else {
                                    SignallingServerConnection.logger.debug('not sending pong to ' + this.serverURL + ': connection is not open');
                                }

                            } else if (message['action'] === 'pong') { 
                                SignallingServerConnection.logger.trace('received pong from server ' + this.serverURL);
                            } else if (message['action'] === 'send') {
                                const linkupId = message['linkupId'];
                                const callId   = message['callId'];
                                const raw      = message['raw'];

                                if (callId !== undefined) {
                                    const linkupIdCalls = this.messageCallbacks.get(linkupId);
                                    let found = false;
                                    if (linkupIdCalls !== undefined) {
                                        let callMessageCallbacks = linkupIdCalls.get(callId);
                                        if (callMessageCallbacks !== undefined) {
                                            callMessageCallbacks.forEach((callback: MessageCallback) => {
                                                SignallingServerConnection.logger.debug('Delivering linkup message to ' + linkupId + ' on call ' + message['callId']);
                                                callback(message['instanceId'], message['data']);
                                                found = true;
                                            });
                                        }
                                    }

                                    if (!found) {
                                        found = false;
                                        let linkupIdCallbacks = this.newCallMessageCallbacks.get(linkupId);
                                        if (linkupIdCallbacks !== undefined) {
                                            linkupIdCallbacks.forEach((callback: NewCallMessageCallback) => {
                                                SignallingServerConnection.logger.debug('Calling default callback for linkupId ' + linkupId + ', unlistened callId is ' + callId);
                                                callback(new LinkupAddress(message['replyServerUrl'], message['replyLinkupId']), new LinkupAddress(this.serverURL, linkupId), callId, message['instanceId'], message['data']);
                                                found = true;
                                            })
                                        }
            
                                        if (!found) {
                                            SignallingServerConnection.logger.warning('Received message for unlistened linkupId: ' + linkupId, message);
                                        }
                                    }
                                } else if (raw !== undefined && raw === 'true') {

                                    let callbacks = this.rawMessageCallbacks.get(linkupId);

                                    if (callbacks !== undefined) {
                                        callbacks.forEach((callback: RawMessageCallback) => {
                                            SignallingServerConnection.logger.debug('Calling raw message callback for linkupId ' + linkupId);
                                            callback(new LinkupAddress(message['replyServerUrl'], message['replyLinkupId']), new LinkupAddress(this.serverURL, linkupId), message['data']);
                                        });
                                    }
                                }
                                

                                
                            } else if (message['action'] === 'query-reply') {

                                const queryId = message['queryId'];
                                const hits   = message['hits'];
                                
                                let callback = this.listeningAddressesQueryCallback;

                                if (callback !== undefined) {
                                    let matchingLinkupAddresses = new Array<LinkupAddress>();
                                    for (const linkupId of hits) {
                                        matchingLinkupAddresses.push(new LinkupAddress(this.serverURL, linkupId));
                                    }
                                    callback(queryId, matchingLinkupAddresses);
                                }
                            } else if (message['action'] === 'update-challenge') { 
                                this.challenge = message['challenge'];

                                for (const address of this.linkupIdsToListen.values()) {
                                    
                                    if (address.identity !== undefined && 
                                        address.linkupId.slice(0, LinkupAddress.verifiedIdPrefix.length) === LinkupAddress.verifiedIdPrefix) {
                                        
                                        this.setUpListener(address);
                                    }
                                }

                            } else {
                                SignallingServerConnection.logger.info('received unknown message on ' + this.serverURL + ': ' + ev.data);
                            }
                        };
            
                        this.ws.onopen = () => {
                            SignallingServerConnection.logger.debug('done creating websocket to URL ' + this.serverURL);
                            this.setUpListeners();
                            this.emptyMessageQueue();
                        };

                        this.ws.onerror = (ev: Event) => {
                            ev;
                            SignallingServerConnection.logger.debug('Error in websocket for server ' + this.serverURL + ':');
                            //SignallingServerConnection.logger.error(ev);
                        };
                    }

                }
                return false;
            }
        } else {
            return false;
        }
    }

    setUpListeners() {
        for (let address of this.linkupIdsToListen.values()) {
            this.setUpListener(address);
        }
    }

    setUpListenerIfNew(address: LinkupAddress) {
        if (!this.linkupIdsToListen.has(address.linkupId)) {
            this.setUpListener(address);
            this.linkupIdsToListen.set(address.linkupId, address);
        }
    }

    // Notice this function is idempotent
    setUpListener(address: LinkupAddress) {

        // check if we need to send a LISTEN message
        if (this.ws !== null && this.ws.readyState === this.ws.OPEN) {
            try {
                SignallingServerConnection.logger.debug('sending listen command through websocket for linkupId ' + address.linkupId);
                
                const msg = {'action': 'listen', 'linkupId': address.linkupId} as any;

                if (address.identity !== undefined && 
                    this.challenge !== undefined && 
                    address.linkupId.slice(0, LinkupAddress.verifiedIdPrefix.length) === LinkupAddress.verifiedIdPrefix) {
                        msg.idContext = address.identity.toLiteralContext();
                        address.identity.sign(this.challenge).then((sig: string) => {
                            msg.signature = sig;
                            if (this.ws !== null && this.ws.readyState === this.ws.OPEN) {
                                this.ws.send(JSON.stringify(msg));
                            }
                        })
                } else {
                    this.ws.send(JSON.stringify(msg));
                }
                
                
            } catch (e: any) {
                SignallingServerConnection.logger.warning('Error while trying to set up listener for ' + address.linkupId + ' for linkup server ' + this.serverURL);
                SignallingServerConnection.logger.error(e);
                // this.checkWebsocket(); // I'm afraid this may cause a loop
            }
        }
    }

    private emptyMessageQueue() {
        if (this.checkWebsocket()) {
            SignallingServerConnection.logger.debug('about to empty message queue to ' +
                                            this.serverURL + ' (' + this.messageQueue.length +
                                            ' messages to send)');
            while (this.messageQueue.length > 0) {
                let message = this.messageQueue.shift() as string;
                let ws      = this.ws as WebSocket;
                SignallingServerConnection.logger.trace('about to send this to ' + this.serverURL);
                SignallingServerConnection.logger.trace(message);
                try {
                    ws.send(message);
                } catch (e: any) {
                    SignallingServerConnection.logger.warning('Could not send message to signalling server ' + this.serverURL + ' - will retry.');
                    SignallingServerConnection.logger.error(e);
                    this.messageQueue.unshift(message);
                    break;           
                }
                
            }
        }
    }

    private enqueueAndSend(message: string) {
        this.messageQueue.push(message);
        this.emptyMessageQueue();
    }

    close() {

        if (!this.closed) {
            this.closed = true;

            if (this.ws?.readyState !== WebSocket.CLOSED && this.ws?.readyState !== WebSocket.CLOSING) {
                this.ws?.close();
            }

            if (this.checkReceptionInterval !== undefined) {
                clearInterval(this.checkReceptionInterval);
            }
        }
    }

}

export { SignallingServerConnection, InstanceId };