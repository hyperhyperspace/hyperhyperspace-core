import { LinkupAddress, LinkupManager } from '../linkup';
import { Logger, LogLevel } from 'util/logging';

import { WebRTCShim } from 'webrtcpoly';

/* A WebRTC Connection is used to create a bi-directional
   DataChannel between two hosts. A LinkupManager object 
   is used to send signalling messages between the two parties
   in order to establish the browser-to-browser connection. */

const RTC_CONN_DESCRIPTION = 'RTC_CONN_DESCRIPTION';
const ICE_CANDIDATE = 'ICE_CANDIDATE';

class WebRTCConnection {

    static logger = new Logger(WebRTCConnection.name, LogLevel.INFO);

    readonly linkupManager : LinkupManager;
    readonly localAddress  : LinkupAddress;
    readonly remoteAddress : LinkupAddress;
    readonly callId : string;

    channelName  : string | undefined;
    connection   : RTCPeerConnection | undefined;
    channel      : RTCDataChannel | undefined;
    initiator    : boolean;
    gatheredICE  : boolean;

    readyCallback   : (conn: WebRTCConnection) => void;
    messageCallback : ((data: any) => void) | null;

    incomingMessages : any[];

    onmessage : (ev: MessageEvent) => void;
    onready : () => void;
    channelStatusChangeCallback : () => void;

    private handleSignallingMessage : (message: any) => void;

    constructor(linkupManager: LinkupManager, local: LinkupAddress, remote: LinkupAddress, callId: string, readyCallback : (conn: WebRTCConnection) => void) {

        this.linkupManager = linkupManager;
        this.localAddress  = local;
        this.remoteAddress = remote;
        this.callId       = callId;

        this.initiator    = false;
        this.gatheredICE  = false;

        this.readyCallback   = readyCallback;
        this.messageCallback = null;

        this.incomingMessages = [];

        this.onmessage = (ev) => {
            WebRTCConnection.logger.debug(this.localAddress?.linkupId + ' received message from ' + this.remoteAddress?.linkupId + ' on call ' + this.callId);
            WebRTCConnection.logger.trace('message is ' + ev.data);
            if (this.messageCallback != null) {
                this.messageCallback(ev.data);
            } else {
                this.incomingMessages.push(ev);
            }
        };

        this.onready = () => {
            WebRTCConnection.logger.debug('connection from ' + this.localAddress?.linkupId + ' to ' + this.remoteAddress?.linkupId + ' is ready for call ' + this.callId);
            this.readyCallback(this);
        };

        this.channelStatusChangeCallback = () => {
            if (this.channel === undefined) {
                WebRTCConnection.logger.debug('channel status callback was called, but channel is null');
            } else {
                WebRTCConnection.logger.debug('channel status is ' + this.channel.readyState);
            }
        
        }

        this.handleSignallingMessage = (message) => {

            var signal  = message['signal'];
            var data    = message['data'];
    
            WebRTCConnection.logger.debug(this.localAddress?.linkupId + ' is handling ' + signal + ' from ' + this.remoteAddress?.serverURL + ' on call ' + data['callId']);
            WebRTCConnection.logger.trace('received data is ' + JSON.stringify(data));
            switch (signal) {
                case RTC_CONN_DESCRIPTION:
                    this.handleReceiveConnectionDescription(data['callId'], data['channelName'], data['description']);
                break;
                case ICE_CANDIDATE:
                    this.handleReceiveIceCandidate(data['candidate']);
                break;
            }
            };
    }

    getCallId() {
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
        return this.channel !== undefined && this.channel.readyState === 'open';
    }

    setMessageCallback(messageCallback: (message:any) => void) {
        this.messageCallback = messageCallback;

        if (messageCallback != null) {
            while (this.incomingMessages.length > 0) {
                var ev = this.incomingMessages.shift();
                messageCallback(ev.data);
            }
        }
    }

    /* To initiate a connection, an external entity must create
        a WebRTCConnection object and call the open() method. */

    open(channelName: string) {
        this.init();
        this.initiator   = true;
        this.channelName = channelName;

        this.setUpLinkupListener()

        this.channel =
                this.connection?.createDataChannel(channelName);
            this.setUpChannel();

        this.connection?.createOffer().then(
            (description) => {
                this.connection?.setLocalDescription(description);
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

    answer(message: any) {
        this.init();

        this.initiator   = false;
        this.handleSignallingMessage(message);
    }

    close() {
        if (this.connection !== undefined) {
            this.connection.close();
        }
    }

    send(message: any) {
        WebRTCConnection.logger.trace(this.localAddress?.linkupId + ' sending msg to ' + this.remoteAddress?.linkupId + ' through channel ' + this.channelName + ' on call ' + this.callId);
        this.channel?.send(message);
    }

    private init(ICEServers? : any) {
        let servers     = ICEServers === undefined ? {iceServers : [{urls : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']}]} : ICEServers;

        this.connection     = WebRTCShim.getNewRTCPeerConnection(servers);
        this.gatheredICE    = false;

        this.connection.onicecandidate = (ev) => {
            if (ev.candidate == null) {
                this.gatheredICE = true;
                WebRTCConnection.logger.debug(this.callId + ' is done gathering ICE candiadtes');
            } else {
                this.signalIceCandidate(ev.candidate);
            }
        };

    }

    private setUpLinkupListener() {
        this.linkupManager.listenForMessagesOnCall(this.localAddress, this.callId, this.handleSignallingMessage);
    }


    private signalConnectionDescription(description: RTCSessionDescriptionInit) {
        this.signalSomething(RTC_CONN_DESCRIPTION,
                            {'callId':          this.callId,
                             'channelName': this.channelName,
                             'description': description
                            });
    }

    private signalIceCandidate(candidate: RTCIceCandidate) {
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
            WebRTCConnection.logger.error('Received message for callId ' + callId + ' but expected ' + this.callId);
        }

        if (this.connection !== undefined) {
            this.connection.ondatachannel = (ev) => {
                WebRTCConnection.logger.debug(this.localAddress.linkupId + ' received DataChannel from ' + this.remoteAddress.linkupId + ' on call ' + this.callId);
                this.channel = ev.channel;
                this.setUpChannel();
            }

            this.connection.setRemoteDescription(description);
        } else {
            WebRTCConnection.logger.error('Received message for callId ' + callId + ' but connection was undefined on ' + this.localAddress.linkupId);
        }
        

        

        if (! this.initiator) {
            this.setUpLinkupListener()
            this.connection?.createAnswer().then(
                (description: RTCSessionDescriptionInit) => {
                    this.connection?.setLocalDescription(description);
                    this.signalConnectionDescription(description);
                },
                (error) => {
                    WebRTCConnection.logger.error('error generating answer: ' + error + ' for callId ' + this.callId + ' on ' + this.localAddress.linkupId);
                }
            );
        }
    }

    private handleReceiveIceCandidate(candidate: RTCIceCandidateInit) {
        this.connection?.addIceCandidate(candidate);
    }

    private setUpChannel() {

        let stateChange = () => {
            WebRTCConnection.logger.debug(this.callId + ' readyState now is ' + this.channel?.readyState);
            if (this.channel?.readyState === 'open') {
                this.onready();
            };
        }

        if (this.channel !== undefined) {
            this.channel.onmessage = this.onmessage;
            this.channel.onopen    = stateChange;
            this.channel.onclose   = stateChange;
        }
  }
}

export { WebRTCConnection };
