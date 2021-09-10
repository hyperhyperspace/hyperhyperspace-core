import { Logger, LogLevel } from 'util/logging';

import { LinkupServer, RawMessageCallback, NewCallMessageCallback, MessageCallback, ListeningAddressesQueryCallback } from './LinkupServer';
import { LinkupAddress } from './LinkupAddress';

const CONN_BACKOFF_TIME = 15000;

class SignallingServerConnection implements LinkupServer {

    static logger = new Logger(SignallingServerConnection.name, LogLevel.ERROR);

    static WRTC_URL_PREFIX = 'wrtc+';

    static isWebRTCBased(serverURL: string) {
        return serverURL.startsWith(SignallingServerConnection.WRTC_URL_PREFIX);
    }

    static getRealServerURL(serverURL: string) {
        return serverURL.slice(SignallingServerConnection.WRTC_URL_PREFIX.length);
    }

    readonly serverURL : string;

    ws : WebSocket | null;

    rawMessageCallbacks     : Map<string, Set<RawMessageCallback>>;
    newCallMessageCallbacks : Map<string, Set<NewCallMessageCallback>>;
    messageCallbacks        : Map<string, Map<string, Set<MessageCallback>>>;

    listeningAddressesQueryCallback? : ListeningAddressesQueryCallback;

    linkupIdsToListen : Set<string>;

    messageQueue     : string[];

    lastConnectionAttempt?: number;

    constructor(serverURL : string) {

        if (!SignallingServerConnection.isWebRTCBased(serverURL)) {
            throw new Error('LinkupServerConnection expects a URL that starts with "' + SignallingServerConnection.WRTC_URL_PREFIX + '", bailing out.');
        }

        this.serverURL = serverURL;

        this.ws = null;

        this.rawMessageCallbacks     = new Map();
        this.newCallMessageCallbacks = new Map();
        this.messageCallbacks        = new Map();

        this.linkupIdsToListen = new Set();

        this.messageQueue = [];

        this.checkWebsocket();
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

        this.setUpListenerIfNew(recipient.linkupId);
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
        
        this.setUpListenerIfNew(recipient.linkupId);
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

        this.setUpListenerIfNew(recipient.linkupId);
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
                                            callback(message['data']);
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
                                            callback(new LinkupAddress(message['replyServerUrl'], message['replyLinkupId']), new LinkupAddress(this.serverURL, linkupId), callId, message['data']);
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
    }

    setUpListeners() {
        for (let linkupId of this.linkupIdsToListen) {
            this.setUpListener(linkupId);
        }
    }

    setUpListenerIfNew(linkupId: string) {
        if (!this.linkupIdsToListen.has(linkupId)) {
            this.setUpListener(linkupId);
            this.linkupIdsToListen.add(linkupId);
        }
    }

    // Notice this function is idempotent
    setUpListener(linkupId: string) {

        // check if we need to send a LISTEN message
        if (this.ws !== null && this.ws.readyState === this.ws.OPEN) {
            try {
                SignallingServerConnection.logger.debug('sending listen command through websocket for linkupId ' + linkupId);    
                this.ws.send(JSON.stringify({'action': 'listen', 'linkupId': linkupId}));
            } catch (e: any) {
                SignallingServerConnection.logger.warning('Error while trying to set up listener for ' + linkupId + ' for linkup server ' + this.serverURL);
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
        this.ws?.close();
    }

}

export { SignallingServerConnection };