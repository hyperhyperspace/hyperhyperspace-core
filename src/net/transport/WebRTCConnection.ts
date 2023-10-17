import { LinkupAddress, LinkupManager } from '../linkup';
import { Logger, LogLevel } from '../../util/logging';

//import 'poly/webrtcpoly';

import { Connection } from './Connection';
import { MessageCallback } from 'net/linkup/LinkupServer';

/* A WebRTC Connection is used to create a bi-directional
   DataChannel between two hosts. A LinkupManager object 
   is used to send signalling messages between the two parties
   in order to establish the browser-to-browser connection. */

const RTC_CONN_DESCRIPTION = 'RTC_CONN_DESCRIPTION';
const ICE_CANDIDATE = 'ICE_CANDIDATE';

class WebRTCConnection implements Connection {

    static isAvailable() {
        return globalThis.RTCPeerConnection !== undefined;
    }

    static logger = new Logger(WebRTCConnection.name, LogLevel.INFO);
    static iceLogger = new Logger(WebRTCConnection.name, LogLevel.INFO)

    readonly linkupManager : LinkupManager;
    readonly localAddress  : LinkupAddress;
    readonly remoteAddress : LinkupAddress;
    readonly callId : string;

    channelName  : string | undefined;
    connection   : RTCPeerConnection | undefined;
    channel      : RTCDataChannel | undefined;
    initiator    : boolean;
    gatheredICE  : boolean;

    readyCallback   : (conn: Connection) => void;
    messageCallback : ((data: any, conn: Connection) => void) | undefined;
    bufferedAmountLowCallback: ((conn: Connection) => void) | undefined;
    bufferedAmountLowThreshold?: number;

    incomingMessages : any[];

    onmessage : (ev: MessageEvent) => void;
    onready : () => void;
    channelStatusChangeCallback : ((channelStatus: string, connectionStatus: string, conn: Connection) => void) | undefined;

    remoteInstanceId?: string;

    private handleSignallingMessage : MessageCallback;

    startup = Date.now();

    constructor(linkupManager: LinkupManager, local: LinkupAddress, remote: LinkupAddress, callId: string, readyCallback : (conn: Connection) => void, channelStatusChangeCallback?: (channelStatus: string, connectionStatus: string, conn: Connection) => void) {

        this.linkupManager = linkupManager;
        this.localAddress  = local;
        this.remoteAddress = remote;
        this.callId       = callId;

        this.initiator    = false;
        this.gatheredICE  = false;

        this.readyCallback   = readyCallback;
        this.messageCallback = undefined;
        this.bufferedAmountLowCallback = undefined

        this.incomingMessages = [];

        this.onmessage = (ev) => {

            WebRTCConnection.logger.debug(this.localAddress?.linkupId + ' received message from ' + this.remoteAddress?.linkupId + ' on call ' + this.callId);
            WebRTCConnection.logger.trace('message is ' + ev.data);
            if (this.messageCallback != undefined) {
                this.messageCallback(ev.data, this);
            } else {
                this.incomingMessages.push(ev);
            }
        };

        this.onready = () => {
            WebRTCConnection.logger.debug('connection from ' + this.localAddress?.linkupId + ' to ' + this.remoteAddress?.linkupId + ' is ready for call ' + this.callId + ', estab. took ' + (Date.now() - this.startup) + ' ms (initiatior: ' + this.initiator + ')');
            this.readyCallback(this);
        };

        this.channelStatusChangeCallback = channelStatusChangeCallback;

        this.handleSignallingMessage = (instanceId: string, message: any) => {

            if (this.remoteInstanceId === undefined) {
                this.remoteInstanceId = instanceId;
            }

            if (this.remoteInstanceId === instanceId) {
                var signal  = message['signal'];
                var data    = message['data'];
        
                WebRTCConnection.logger.debug(this.localAddress?.linkupId + ' is handling ' + signal + ' from ' + this.remoteAddress?.serverURL + ' on call ' + data['callId']);
                WebRTCConnection.logger.trace('received data is ' + JSON.stringify(data));
                switch (signal) {
                    case RTC_CONN_DESCRIPTION:
                        this.handleReceiveConnectionDescription(data['callId'], data['channelName'], data['description']);
                    break;
                    case ICE_CANDIDATE:
                        WebRTCConnection.iceLogger.debug('received ICE candidate:');
                        WebRTCConnection.iceLogger.debug(data['candidate']);
                        this.handleReceiveIceCandidate(data['candidate']);
                    break;
                }
            } else {
                WebRTCConnection.logger.debug('discarding signalling message: expected remote instance id to be ' + this.remoteInstanceId + ' but got ' + instanceId);
            }
        };
    }

    getConnectionId() {
        return this.callId;
    }

    initiatedLocally() {
        return this.initiator;
    }

    // possible values: 'unknown', 'connecting', 'open', 'closed', 'closing';
    channelStatus() {
        if (this.channel === undefined) {
            return 'unknown';
        } else {
            return this.channel.readyState;
        }
    }

    channelIsOperational() {
        return this.connection !== undefined && this.connection.connectionState !== 'disconnected' &&
               this.connection.connectionState !== 'closed' && this.connection.connectionState !== 'failed' &&
               this.channel !== undefined && this.channel.readyState === 'open';
    }

    setMessageCallback(messageCallback: (message: any, conn: Connection) => void) {
        this.messageCallback = messageCallback;

        if (messageCallback != undefined) {
            while (this.incomingMessages.length > 0) {
                var ev = this.incomingMessages.shift();
                messageCallback(ev.data, this);
            }
        }
    }

    /* To initiate a connection, an external entity must create
        a WebRTCConnection object and call the open() method. */

    open(channelName='mesh-network-channel') {

        if (this.initiator === true) {
            WebRTCConnection.logger.warning('Opening connection ' + this.callId + ' a second time, this is not right, ignoring.');
            
            return;
        }

        this.init();
        this.initiator   = true;
        this.channelName = channelName;

        this.setUpLinkupListener()

        this.channel =
                this.connection?.createDataChannel(channelName);
        
        if (this.connection === undefined) {
            WebRTCConnection.logger.error('Failed to create data channel, connection is undefined');
        }
        
        this.setUpChannel();

        const conn = this.connection;

        this.connection?.createOffer().then(
            (description) => {
                if (this.connection?.signalingState !== 'closed') {
                    this.connection?.setLocalDescription(description).catch((reason: any) => {
                        WebRTCConnection.logger.debug('failed to set local description while in ' + this.connection?.signalingState);
                        WebRTCConnection.logger.debug('conn has changed: ' + (conn !== this.connection));
                        WebRTCConnection.logger.debug('reason:', JSON.stringify(reason));
                    });
                }
                this.signalConnectionDescription(description);
            },
            (error) => {
                WebRTCConnection.logger.error('error creating offer: ' + error);
            });
    }

  /* Upon receiving a connection request, an external entity
     must create a connection and pass the received message,
     alongisde the LinkupListener and LinkupCaller to be used
     for signalling, to the answer() method. After receiving
     the initial message, the connection will configure the
     listener to pass along all following signalling messages. */

    answer(instanceId: string, message: any) {
        this.init();

        this.initiator   = false;

        this.handleSignallingMessage(instanceId, message);
    }

    /* Sometimes the receiving end defers accepting the connection a bit,
       and several signalling messages crop up. */
    receiveSignallingMessage(instanceId: string, message: any) {
        this.handleSignallingMessage(instanceId, message);
    }

    close() {
        WebRTCConnection.logger.debug('Closing connection ' + this.callId);

        if (this.channel !== undefined) {
            this.channel.close();
            this.channel = undefined;
        }

        if (this.connection !== undefined) {
            this.connection.close();
            this.connection = undefined;
        }
    }

    send(message: any) {

        WebRTCConnection.logger.debug(this.localAddress?.linkupId + ' sending msg to ' + this.remoteAddress?.linkupId + ' through channel ' + this.channelName + ' on call ' + this.callId);

        if (this.channel === undefined) {
            WebRTCConnection.logger.warning('Attempting to send over missing channel in connection ' + this.callId + ' at ' + Date.now());
            throw new Error('Attempting to send over missing channel in connection ' + this.callId + ' at ' + Date.now())
        }
        
        this.channel.send(message);
        
        WebRTCConnection.logger.trace('Done sending msg');
        
    }

    bufferedAmount(): number {
        if (this.channel !== undefined) {
            return this.channel.bufferedAmount;
        } else {
            return 0;
        }
    }

    setBufferedAmountLowCallback(callback: (conn: Connection) => void, bufferedAmountLowThreshold: number = 0) {
        this.bufferedAmountLowCallback = callback;
        this.bufferedAmountLowThreshold = bufferedAmountLowThreshold;
    }

    private init(ICEServers? : any) {

        if (this.connection === undefined) {

            let servers     = ICEServers === undefined ? {iceServers : [{urls : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']}]} : ICEServers;

            this.connection     = new RTCPeerConnection(servers);
            this.gatheredICE    = false;

            this.connection.onicecandidate = (ev) => {
                WebRTCConnection.iceLogger.debug('onicecandidate was called with:');
                WebRTCConnection.iceLogger.debug(JSON.stringify(ev.candidate));
                if (ev.candidate == null) {
                    this.gatheredICE = true;
                    WebRTCConnection.logger.debug(this.callId + ' is done gathering ICE candiadtes');
                } else {
                    this.signalIceCandidate(ev.candidate);
                }
            };

            this.connection.onconnectionstatechange = () => {
                WebRTCConnection.logger.debug(this.callId + ' connectionState now is ' + this?.connection?.connectionState);

                if (this.channelStatusChangeCallback !== undefined) {
                    this.channelStatusChangeCallback(this.channel?.readyState || 'unknown', this.connection?.connectionState || 'unknown', this);
                }
            };

        }
    }

    private setUpLinkupListener() {
        this.linkupManager.listenForMessagesOnCall(this.localAddress, this.callId, this.handleSignallingMessage);
    }


    private signalConnectionDescription(description: RTCSessionDescriptionInit) {
        this.signalSomething(RTC_CONN_DESCRIPTION,
                            {'callId':      this.callId,
                             'channelName': this.channelName,
                             'description': description
                            });
    }

    private signalIceCandidate(candidate: RTCIceCandidate) {
        WebRTCConnection.iceLogger.debug('sending ice:');
        WebRTCConnection.iceLogger.debug(candidate);
        this.signalSomething(ICE_CANDIDATE,
                              {'callId':          this.callId,
                               'channelName': this.channelName,
                               'candidate':   candidate
                              });
  }

    private signalSomething(signal: string, data: any) {
        WebRTCConnection.logger.debug(this.localAddress.linkupId + ' signalling to ' + this.remoteAddress.linkupId + ' on call ' + this.callId + ' (' + signal + ')');
        WebRTCConnection.logger.trace('sent data is ' + JSON.stringify(data));
        let envelope = { 'signal' : signal,
                         'data'   : data };
        this.linkupManager.sendMessageOnCall(this.localAddress, this.remoteAddress, this.callId, envelope);
    }

    private handleReceiveConnectionDescription(callId: string, channelName: string, description: RTCSessionDescriptionInit) {

        if (callId === this.callId) {
            if (this.channelName === undefined) {
                this.channelName = channelName;
            }
        } else {
            WebRTCConnection.logger.warning('Received message for callId ' + callId + ' but expected ' + this.callId);
        }

        if (this.connection !== undefined) {

            if (this.connection.signalingState !== 'closed') {
                this.connection.ondatachannel = (ev) => {
                    WebRTCConnection.logger.debug(this.localAddress.linkupId + ' received DataChannel from ' + this.remoteAddress.linkupId + ' on call ' + this.callId);
                    this.channel = ev.channel;
                    this.setUpChannel();
                }
    
                this.connection.setRemoteDescription(description).catch((reason: any) => {
                    WebRTCConnection.logger.debug('Failed to set remote description, reason: ' + JSON.stringify(reason)); //TODO: warning? investigate more?
                 });    
            } else {
                WebRTCConnection.logger.debug('A remote description arrived untimely (signalingState=="closed") and will be ignored.');
            }

        } else {
            WebRTCConnection.logger.debug('A remote description arrived untimely (this.connection===undefined) and will be ignored.');
        }


        if (! this.initiator) {
            this.setUpLinkupListener()
            this.connection?.createAnswer().then(
                (description: RTCSessionDescriptionInit) => {
                    try {
                        this.connection?.setLocalDescription(description);
                    } catch (e) {
                        WebRTCConnection.logger.debug('Failed to set local description, error:', e); // TODO: warning? investigate more?
                        WebRTCConnection.logger.debug('Description object was:', description);
                    }
                    
                    this.signalConnectionDescription(description);
                },
                (error) => {
                    // TODO: warning? investigate more?
                    WebRTCConnection.logger.debug('error generating answer: ' + error + ' for callId ' + this.callId + ' on ' + this.localAddress.linkupId);
                }
            );
        }
    }

    private handleReceiveIceCandidate(candidate: RTCIceCandidateInit) {
        this.connection?.addIceCandidate(candidate).catch((reason: any) => {
            WebRTCConnection.logger.debug('Failed to set ICE candidate, reason: ' + JSON.stringify(reason));
        });
    }

    private setUpChannel() {

        let stateChange = () => {
            WebRTCConnection.logger.debug(this.callId + ' readyState now is ' + this.channel?.readyState);

            if (this.channel?.readyState === 'open') {
                this.onready();
            };

            if (this.channelStatusChangeCallback !== undefined) {
                this.channelStatusChangeCallback(this.channel?.readyState || 'unknown', this.connection?.connectionState || 'unknown', this);
            }
        };

        let bufferAmountLow = () => {
            WebRTCConnection.logger.trace(this.callId + ' bufferedAmountLow reached');

            if (this.bufferedAmountLowCallback !== undefined) {
                this.bufferedAmountLowCallback(this);
            }
        };

        if (this.channel !== undefined) {
            this.channel.onmessage = this.onmessage;
            this.channel.onopen    = stateChange;
            this.channel.onclose   = stateChange;
            this.channel.onbufferedamountlow = bufferAmountLow;

            if (this.bufferedAmountLowThreshold !== undefined) {
                this.channel.bufferedAmountLowThreshold = this.bufferedAmountLowThreshold;
            }
        }
    }


}

export { WebRTCConnection };
