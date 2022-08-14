import { Agent, AgentId } from '../../service/Agent';

import { AgentPod, AgentEvent } from '../../service/AgentPod';

import { NetworkAgent, ConnectionId, 
         NetworkEventType, ConnectionStatusChangeEvent, 
         ConnectionStatus, MessageReceivedEvent, Endpoint } from '../network/NetworkAgent';

import { RNGImpl }      from 'crypto/random';
import { HMACImpl }     from 'crypto/hmac';
import { ChaCha20Impl } from 'crypto/ciphers';

import { Identity }     from 'data/identity';
import { Hash, Hashing, LiteralContext, 
         HashedObject } from 'data/model';

import { Strings }          from 'util/strings';
import { Logger, LogLevel } from 'util/logging';


/*
 * SecureNetworkAgent: Verify that the other end of a connection is in possession of
 *                     a given Identity (a key pair whose public part, when joined with
 *                     some additional information, hashes to a given value) and use
 *                     the key pair to securely send a secret that can be used later to
 *                     send encrypted messages (and of course also implement the recipient
 *                     side of this exchange).
 * 
 */

/* The methods sendIdentityChallenge and answerIdentityChallenge must be called locally
 * by the agent(s) that need to secure the connections on both ends.
 *
 * Once the authentication is done, which will be notified via an event, the method
 * sendSecureMessage can be used to send a message, that will show up as a local event
 * for the target agent on the receiving end of the connection.
 * 
 */

type Status = IdHolderStatus | IdChallengerStatus;

enum IdHolderStatus {
    ExpectingChallenge                = 'expecting-challenge',
    ReceivedUnexpectedChallenge       = 'received-unexpected-challenge',
    ReceivedUnexpectedIdentityRequest = 'received-unexpected-identity-request',
    SentIdentity                      = 'sent-identity',
    SentChallengeAnswer               = 'sent-challenge-answer',
    IdentityVerified                  = 'identity-verified',
    IdentityRejected                  = 'identity-rejected'
};

enum IdChallengerStatus {
    WaitingToChallenge  = 'waiting-to-challenge',
    SentIdentityRequest = 'sent-identity-request',
    SentChallenge       = 'sent-challenge',
    IdentityVerified    = 'identity-verified',
    IdentityRejected    = 'identity-rejected'
}

// The following state machine models conneciton validation:

// id holder:

// nil -> 'received-unexpected-identity-request'     on 'request-identity' message reception
// nil -> 'received-unexpected-challenge'            on 'send-challenge'   message reception
// nil -> 'expecting-challenge'                      on answerIdentityChallenge() call
// 'expecting-challenge' -> 'sent-identity'          on 'request-identity' message reception
// 'sent-identity'       -> 'sent-challenge-answer'  on 'send-challenge'   message reception
// 'expecting-challenge' -> 'sent-challenge-answer'  on 'send-challenge'   message reception
// 'sent-challenge-answer' -> 'identity-verified'    on 'challenge-result' message reception (accepted)
// 'sent-challenge-answer' -> 'identity-rejected'    on 'challenge-result' message reception (rejected)

// id challenger:

// nil -> 'waiting-to-challenge'      on sendIdentityChallenge() call (connection not ready yet)
// nil -> 'sent-identity-request'     on sendIdentityChallenge() call, without identity (connected)
// nil -> 'sent-challenge'            on sendIdentityChallenge() call, with identity    (connected)
// 'waiting-to-challenge'  -> 'sent-identity-request' on connection ready, no identity
// 'waiting-to-challenge'  -> 'sent-challenge'        on connection ready, identity present
// 'sent-identity-request' -> 'sent-challenge'     on 'send-identity' message reception
// 'sent-challente'        -> 'identity-verified'  on 'answer-challenge' message reception (accepted)
// 'sent-challenge'        -> 'identity-rejected'  on 'answer-challenge'  message reception (rejected)


enum MessageType {
    RequestIdentity = 'request-identity',
    SendIdentity    = 'send-identity',
    SendChallenge   = 'send-challenge',
    AnswerChallenge = 'answer-challenge',
    ChallengeResult = 'challenge-result',
    SecureMessage   = 'secure-message',
};

type ControlMessage = IdHolderMessage | IdChallengerMessage | SecureMessage;
type IdHolderMessage     = SendIdentityMessage | AnswerChallengeMessage;
type IdChallengerMessage = RequestIdentityMessage | SendChallengeMessage | ChallengeResultMessage;

type RequestIdentityMessage = {
    type: MessageType.RequestIdentity,
    identityHash: Hash
}

type SendIdentityMessage = {
    type: MessageType.SendIdentity,
    identityHash: Hash,
    identity: LiteralContext
}

type SendChallengeMessage = {
    type: MessageType.SendChallenge,
    identityHash: Hash,
    encrypedSecret: Array<string>,
}

type AnswerChallengeMessage = {
    type: MessageType.AnswerChallenge,
    identityHash: Hash,
    secretHash: Hash
}

type ChallengeResultMessage = {
    type: MessageType.ChallengeResult,
    identityHash: Hash,
    result: boolean
}

type SecureMessage = {
    type: MessageType.SecureMessage,
    identityHash: Hash,
    payload: string,
    nonce: string,
    hmac: string,
    id?: string,        // optional id, used for fragmenting large messages 
    fragSeq?: number,   // sequence number on a large message fragment
    fragCount?: number  // total number of fragments in a large message
};

type SecureMessagePayload = {
    senderIdentityHash: Hash,
    agentId: AgentId
    content: any
};

enum SecureNetworkEventType {
    SecureMessageReceived  = 'secure-message-received',
    ConnectionIdentityAuth = 'connection-identity-auth'
}

type SecureMessageReceivedEvent = {
    type: SecureNetworkEventType.SecureMessageReceived,
    content: {
        connId: ConnectionId,
        sender: Hash,
        recipient: Hash,
        payload: any
    }
};

type PartialMessage = {
    created: number,
    updated: number,
    connId: ConnectionId,
    recipient: Hash,
    fragCount: number,
    fragments: Map<number, string>
};

enum IdentityAuthStatus {
    Accepted = 'accepted',
    Rejected = 'rejected',
    Requested = 'requested'
};

enum IdentityLocation {
    Local  = 'local',
    Remote = 'remote'
}

type ConnectionIdentityAuthEvent = {
    type: SecureNetworkEventType.ConnectionIdentityAuth,
    content: {
        connId: ConnectionId,
        identityLocation: IdentityLocation,
        identityHash: Hash,
        identity?: Identity,
        status: IdentityAuthStatus
    }
};

class OneWaySecuredConnection {

    static Separator = '__';

    connId    : ConnectionId;

    status?       : Status;
    timeout?      : number;

    identityHash : Hash;
    identity?    : Identity;
    secret?      : string;

    encryptedSecret? : Array<string>;

    constructor(connectionId: ConnectionId, identityHash: Hash) {
        this.connId = connectionId;
        this.identityHash = identityHash;
    }

    verified() {
        return this.status === IdHolderStatus.IdentityVerified;
    }

    generateSecret() {
        this.secret = new RNGImpl().randomHexString(256);
        // use 256 bits so it can be use as a ChaCha20 key
    }

    async encryptSecret() {

        if (this.secret === undefined) {
            throw new Error('Attempted to encrypt connection secret before generating it.');
        }

        if (this.identity === undefined) {
            throw new Error('Attempted to encrypt connection secret, but identity is missing.');
        }

        const encryptedSecret = new Array<string>();

        for (const chunk of Strings.chunk(this.secret, 32)) {
            encryptedSecret.push(await this.identity.encrypt(chunk) as string)
        }


        this.encryptedSecret = encryptedSecret;
    }

    async decryptSecret() {
        
        if (this.identity === undefined) {
            throw new Error('Secured connection cannot decrypt received secret: identity is missing');
        }

        if (!this.identity.hasKeyPair()) {
            throw new Error('Secured connection cannot decrypt received secret: using an identity without a key pair');
        }

        if (this.encryptedSecret === undefined) {
            throw new Error('Secured connection cannot decrypt received secret: it is missing');
        }

        const chunks = new Array<string>();

        for (const encryptedChunk of this.encryptedSecret) {
            chunks.push(await this.identity.decrypt(encryptedChunk));
        }

        this.secret = Strings.unchunk(chunks);
    }

    computeSecretHash() {

        if (this.secret === undefined) {
            throw new Error('Cannot hash secret: it is missing');
        }

        return Hashing.forString(this.secret);
    }

    setTimeout(seconds: number) {
        this.timeout  = new Date().getTime() + seconds * 1000;
    }

    encode() {
        return OneWaySecuredConnection.encode(this.connId, this.identityHash);
    }

    static encode(connectionId: ConnectionId, identity: Hash) {
        return connectionId + OneWaySecuredConnection.Separator + identity;
    }

    static decode(encoded: string) {
        const parts = encoded.split(OneWaySecuredConnection.Separator);
        return new OneWaySecuredConnection(parts[0], parts[1]);
    }
}

class ConnectionSecuredForReceiving extends OneWaySecuredConnection {

    status?: IdHolderStatus;

    constructor(connectionId: ConnectionId, identityHash: Hash) {
        super(connectionId, identityHash);
    }
}

class ConnectionSecuredForSending extends OneWaySecuredConnection {

    status?: IdChallengerStatus;

    constructor(connectionId: ConnectionId, identityHash: Hash) {
        super(connectionId, identityHash);
    }
}

const DEFAULT_TIMEOUT = 15;
const MAX_PAYLOAD_SIZE = 32 * 1024;
const MAX_MESSAGE_FRAGMENTS = 64;

const FRAGMENT_ASSEMBLY_TIMEOUT_FREQ = 2;

class SecureNetworkAgent implements Agent {

    static logger = new Logger(SecureNetworkAgent.name, LogLevel.INFO);

    static Id = 'secure-connection-agent';

    remoteIdentities : Map<string, ConnectionSecuredForSending>;
    localIdentities  : Map<string, ConnectionSecuredForReceiving>;

    messageFragments : Map<string, PartialMessage>;

    fragmentAssemblyInterval?: number;

    pod?: AgentPod;

    private checkFragmentAssemblyInterval() {
        if (this.messageFragments.size === 0) {
            if (this.fragmentAssemblyInterval !== undefined) {
                clearInterval(this.fragmentAssemblyInterval)
            }
        } else {
            if (this.fragmentAssemblyInterval === undefined) {
                setInterval(this.fragmentAssemblyTimeouts, FRAGMENT_ASSEMBLY_TIMEOUT_FREQ * 1000);
            }
        }
    }

    fragmentAssemblyTimeouts() {

        const toRemove = new Array<string>();

        for (const [id, partialMsg] of this.messageFragments.entries()) {
            const timeout = Math.max(12000, 600 * partialMsg.fragCount) + partialMsg.created;
            const updateTimeout = Math.max(timeout, 6000 + partialMsg.updated);
            const now = Date.now();

            if (now > timeout && now > updateTimeout) {
                toRemove.push(id);
                SecureNetworkAgent.logger.warning('Removed message ' + id + ' due to re-assembly timeout!');
            }
        }

        for (const id of toRemove) {
            this.messageFragments.delete(id);
        }

        if (toRemove.length > 0) {
            this.checkFragmentAssemblyInterval();
        }
    }

    constructor() {

        this.remoteIdentities = new Map();
        this.localIdentities  = new Map();

        this.messageFragments = new Map();
        this.fragmentAssemblyInterval = undefined;

        this.fragmentAssemblyTimeouts = this.fragmentAssemblyTimeouts.bind(this);
    }

    getAgentId(): string {
        return SecureNetworkAgent.Id;
    }

    ready(pod: AgentPod): void {
        this.pod = pod;
    }

    receiveLocalEvent(ev: AgentEvent): void {
        if (ev.type === NetworkEventType.ConnectionStatusChange) {
            let connEv = ev as ConnectionStatusChangeEvent;
            
            if (connEv.content.status === ConnectionStatus.Closed) {
                this.removeIdentitiesForConnection(ev.content.connId);
            } else if (connEv.content.status === ConnectionStatus.Ready) {

                for (const secured of this.remoteIdentities.values()) {
                    if (secured.connId === connEv.content.localEndpoint && 
                        secured.status === IdChallengerStatus.WaitingToChallenge) {
                        
                        this.sendChallengeMessage(secured);
                    }
                }                
            }
        } else if (ev.type === NetworkEventType.MessageReceived) {
            let msgEv = ev as MessageReceivedEvent;
            this.receiveMessage(msgEv.content.connectionId , msgEv.content.source, msgEv.content.destination, msgEv.content.content);
        }
    }

    // for identity holder:

    secureForReceiving(connId: ConnectionId, localIdentity: Identity, timeout=DEFAULT_TIMEOUT) {
        
        SecureNetworkAgent.logger.trace('Asked to verify ' + connId + ' for receiving with ' + localIdentity.hash());

        const identityHash = localIdentity.hash();

        let secured = this.getOrCreateConnectionSecuredForReceiving(connId, identityHash);
        secured.identity = localIdentity;
        secured.setTimeout(timeout);

        if (secured.status === IdHolderStatus.ReceivedUnexpectedIdentityRequest) {
            this.sendIdentity(connId, localIdentity, identityHash);
            secured.status = IdHolderStatus.SentIdentity;
        } else if (secured.status === IdHolderStatus.ReceivedUnexpectedChallenge) {
            secured.decryptSecret().then(() => {
                //TODO: see if we have introduced a race condition by making decryptSecret async.
                this.answerReceivedChallenge(connId, identityHash, secured.computeSecretHash());
                secured.status = IdHolderStatus.SentChallengeAnswer;
            })
        } else if (secured.status === undefined) {
            secured.status = IdHolderStatus.ExpectingChallenge;
        } // else, negotiation is already running, just let it run its course

    }

    // for identity challenger:

    secureForSending(connId: ConnectionId, remoteIdentityHash: Hash, remoteIdentity?: Identity, timeout=DEFAULT_TIMEOUT) {
    
        let connInfo = this.getNetworkAgent().getConnectionInfo(connId);

        if (connInfo?.status !== ConnectionStatus.Closed) {

            let secured = this.getOrCreateConnectionSecuredForSending(connId, remoteIdentityHash);
            secured.setTimeout(timeout);

            if (secured.identity === undefined) {
                secured.identity = remoteIdentity;
            }

            if (connInfo?.status === ConnectionStatus.Ready) {
                if (secured.status === undefined || secured.status === 'identity-rejected') {
                    
                    this.sendChallengeMessage(secured);

                } // else, negotiation is already running, just let it run its course
            } else if (connInfo?.status === ConnectionStatus.Received ||
                       connInfo?.status === ConnectionStatus.Establishing) {
                secured.status = IdChallengerStatus.WaitingToChallenge;
            }
        }

    }

    private sendChallengeMessage(secured: ConnectionSecuredForSending) {

        if (secured.identity === undefined) {
            this.sendIdentityRequest(secured.connId, secured.identityHash);
            secured.status  = IdChallengerStatus.SentIdentityRequest;
            SecureNetworkAgent.logger.trace('Sent identity request for ' + secured.identityHash + ' through connection ' + secured.connId);
        } else {
            SecureNetworkAgent.logger.trace('Sending identity challenge for ' + secured.identityHash + ' through connection ' + secured.connId);
            secured.generateSecret();
            //TODO: see if we have introduced a race condition by making encryptSecret async
            secured.encryptSecret().then(() => {
                this.sendKnownIdentityChallenge(secured.connId, secured.identityHash, secured.encryptedSecret as Array<string>);
                secured.status = IdChallengerStatus.SentChallenge;
            });
        }
    }

    // query for already verified local or remote identities

    getLocalVerifiedIdentity(connId: ConnectionId, identityHash: Hash) : Identity | undefined {
        return this.getVerifiedIdentity(connId, identityHash, true);
    }

    getRemoteVerifiedIdentity(connId: ConnectionId, identityHash: Hash) : Identity | undefined {
        return this.getVerifiedIdentity(connId, identityHash, false);
    }

    // messaging, usable once both supplied identities (sender & recipient) 
    // have been verified on that connection

    sendSecurely(connId: ConnectionId, sender: Hash, recipient: Hash, agentId: AgentId, content: any) {
        
        let remote = this.getConnectionSecuredForSending(connId, recipient);
        let local  = this.getConnectionSecuredForReceiving(connId, sender);

        
        if (remote?.verified() && local?.verified()) {

            //console.log(sender + 'sending to ' + recipient + ' (agent is ' + agentId + '):')
            //console.log(content)

            let secureMessagePayload: SecureMessagePayload = {
                senderIdentityHash: sender,
                agentId: agentId,
                content: content
            };

            
            let plaintext = JSON.stringify(secureMessagePayload);
            let nonce = new RNGImpl().randomHexString(96);
            let payload = new ChaCha20Impl().encryptHex(plaintext, remote.secret as string, nonce);
            let hmac = new HMACImpl().hmacSHA256hex(payload, local.secret as string);

            if (plaintext.length < MAX_PAYLOAD_SIZE) {
                let secureMessage: SecureMessage = {
                    type: MessageType.SecureMessage,
                    identityHash: recipient,
                    nonce: nonce,
                    payload: payload,
                    hmac: hmac
                };
    
                this.getNetworkAgent().sendMessage(connId, SecureNetworkAgent.Id, secureMessage);
            } else {
                let chunks = Strings.chunk(payload, MAX_PAYLOAD_SIZE);
                let msgId = new RNGImpl().randomHexString(128);

                let seq = 0;

                if (chunks.length <= MAX_MESSAGE_FRAGMENTS) {
                    for (const chunk of chunks) {
                        let secureMessage: SecureMessage = {
                            type: MessageType.SecureMessage,
                            identityHash: recipient,
                            nonce: nonce,
                            payload: chunk,
                            hmac: hmac,
                            id: msgId,
                            fragSeq: seq,
                            fragCount: chunks.length
                        };
            
                        this.getNetworkAgent().sendMessage(connId, SecureNetworkAgent.Id, secureMessage);
                        
                        seq = seq + 1;
                    }
                } else {
                    SecureNetworkAgent.logger.error('Cannot send message! It needs ' + chunks.length + ' fragments and the max allowed is ' + MAX_MESSAGE_FRAGMENTS + '.');
                }
                

            }

            
        } else {
            throw new Error('Connection ' + connId + ' still has not verified both sender ' + sender + ' and recipient ' + recipient + '.');
        }

    }

    // incoming message processing

    receiveMessage(connId: ConnectionId, source: Endpoint, destination: Endpoint, content: any): void {

        source; destination;

        let controlMessage = content as ControlMessage;
        let identityHash   = controlMessage.identityHash;

        SecureNetworkAgent.logger.trace(() => 'Received message ' + JSON.stringify(content));

        // for id holder:

        if (controlMessage.type === MessageType.RequestIdentity) {
            let secured = this.getOrCreateConnectionSecuredForReceiving(connId, identityHash);

            if (secured.status === IdHolderStatus.ExpectingChallenge) {
                this.sendIdentity(connId, secured.identity as Identity, identityHash);
                secured.status = IdHolderStatus.SentIdentity;
            } else if (secured.status === undefined) {
                secured.status = IdHolderStatus.ReceivedUnexpectedIdentityRequest;

                this.sendAuthEvent(connId, IdentityLocation.Local, identityHash, IdentityAuthStatus.Requested, secured.identity);
            }

        } else if (controlMessage.type === MessageType.SendChallenge) {

            let sendChallengeMessage = content as SendChallengeMessage;
            let secured = this.getOrCreateConnectionSecuredForReceiving(connId, identityHash);

            if (secured.status === IdHolderStatus.ExpectingChallenge || 
                secured.status === IdHolderStatus.SentIdentity) {
                
                secured.encryptedSecret = sendChallengeMessage.encrypedSecret;
                secured.decryptSecret().then(() => {
                    //TODO: see if we have introduced a race condition by making decryptSecret async.
                    this.answerReceivedChallenge(connId, identityHash, secured.computeSecretHash());
                    secured.status = IdHolderStatus.SentChallengeAnswer;
                });
                
            } else if (secured.status === undefined) {
                secured.encryptedSecret = sendChallengeMessage.encrypedSecret;
                secured.status = IdHolderStatus.ReceivedUnexpectedChallenge;

                this.sendAuthEvent(connId, IdentityLocation.Local, identityHash, IdentityAuthStatus.Requested, secured.identity);
            }

        } else if (controlMessage.type === MessageType.ChallengeResult) {

            let challengeResultMessage = content as ChallengeResultMessage;
            let secured = this.getOrCreateConnectionSecuredForReceiving(connId, identityHash);


            if (secured.status === IdHolderStatus.SentChallengeAnswer) {
                if (challengeResultMessage.result) {
                    secured.status = IdHolderStatus.IdentityVerified;
                } else {
                    secured.status = IdHolderStatus.IdentityRejected;
                }

                const authStatus: IdentityAuthStatus = 
                                        challengeResultMessage.result? IdentityAuthStatus.Accepted : IdentityAuthStatus.Rejected;

                this.sendAuthEvent(connId, IdentityLocation.Local, secured.identityHash, authStatus, secured.identity);
            }
        }
        
        // for id challenger:
        
        else if (controlMessage.type === MessageType.SendIdentity) {

            let sendIdentityMessage = content as SendIdentityMessage;
            let secured = this.getOrCreateConnectionSecuredForSending(connId, identityHash);

            if (secured.status === IdChallengerStatus.SentIdentityRequest) {
                let identity = HashedObject.fromLiteralContext(sendIdentityMessage.identity);
                
                if (identity.hash() === identityHash && identity instanceof Identity) {
                    secured.identity = identity;
                    secured.generateSecret();
                    //TODO: see if we have introduced a race condition by making encryptSecret async
                    secured.encryptSecret().then(() => {
                        this.sendKnownIdentityChallenge(connId, identityHash, secured.encryptedSecret as Array<string>);
                        secured.status = IdChallengerStatus.SentChallenge;
                    });
                } else {
                    secured.status = IdChallengerStatus.IdentityRejected;
                }
            }

        } else if (controlMessage.type === MessageType.AnswerChallenge) {
            let answerChallengeMessage = content as AnswerChallengeMessage;
            let secured = this.getOrCreateConnectionSecuredForSending(connId, identityHash);

            if (secured.status === IdChallengerStatus.SentChallenge) {
                let accepted = answerChallengeMessage.secretHash === secured.computeSecretHash();
                if (accepted) {
                    this.sendChallengeResult(connId, identityHash, true);
                    secured.status = IdChallengerStatus.IdentityVerified;                    
                } else {
                    this.sendChallengeResult(connId, identityHash, false);
                    secured.status = IdChallengerStatus.IdentityRejected;
                }

                const authStatus:IdentityAuthStatus = accepted? IdentityAuthStatus.Accepted : IdentityAuthStatus.Rejected;
                this.sendAuthEvent(connId, IdentityLocation.Remote, secured.identityHash, authStatus, secured.identity);
            }

        }

        // for both:

        else if (controlMessage.type === MessageType.SecureMessage) {

            let secureMessage = content as SecureMessage;

            let local = this.getConnectionSecuredForReceiving(connId, secureMessage.identityHash);

            if (local?.verified()) {

                let cyphertext: string|undefined = undefined;
                if (secureMessage.id === undefined) {
                    cyphertext = secureMessage.payload;
                } else {
                    if (secureMessage.fragSeq !== undefined && secureMessage.fragCount !== undefined && 
                        secureMessage.fragCount <= MAX_MESSAGE_FRAGMENTS &&  secureMessage.fragSeq % 1 === 0 &&
                        0 <= secureMessage.fragSeq && secureMessage.fragSeq < secureMessage.fragCount) {
                        let partialMsg = this.messageFragments.get(secureMessage.id);
                        if (partialMsg === undefined) {
                            partialMsg = {
                                created: Date.now(),
                                updated: Date.now(),
                                connId: connId,
                                recipient: secureMessage.identityHash,
                                fragCount: secureMessage.fragCount,
                                fragments: new Map()
                            };
                            this.messageFragments.set(secureMessage.id, partialMsg);
                            this.checkFragmentAssemblyInterval();
                        } else {
                            partialMsg.updated = Date.now();
                        }

                        if (partialMsg.connId === connId &&
                            partialMsg.recipient === secureMessage.identityHash &&
                            partialMsg.fragCount === secureMessage.fragCount &&
                            secureMessage.fragSeq < secureMessage.fragCount) {
                            
                            partialMsg.fragments.set(secureMessage.fragSeq, secureMessage.payload);

                            if (partialMsg.fragments.size === partialMsg.fragCount) {
                                const chunks = new Array<string>();
                                for (let i=0; i<partialMsg.fragCount; i++) {
                                    const chunk = partialMsg.fragments.get(i);
                                    if (chunk !== undefined) {
                                        chunks.push(chunk);
                                    }
                                }
                                
                                if (chunks.length === partialMsg.fragCount) {
                                    cyphertext = Strings.unchunk(chunks);
                                    this.messageFragments.delete(secureMessage.id);
                                    this.checkFragmentAssemblyInterval();
                                } else {
                                    SecureNetworkAgent.logger.warning('Error reassembling msg ' + secureMessage.id);
                                }
                            }

                        }
                    } else {
                        SecureNetworkAgent.logger.warning('Incomplete message fragment: seq or fragments fields are missing or incorrect for ' + secureMessage.id + ': fragCount=' + secureMessage.fragCount + ', fragSeq=' + secureMessage.fragSeq + ' (sender is ' + source + ')');
                    }
                }

                if (cyphertext !== undefined) {
                    let payload = new ChaCha20Impl().decryptHex(cyphertext, local.secret as string, secureMessage.nonce);
                
                    let secureMessagePayload = JSON.parse(payload) as SecureMessagePayload;
    
                    let remote = this.getConnectionSecuredForSending(connId, secureMessagePayload.senderIdentityHash);
                    if (remote?.verified()) {
    
                        let hmac = new HMACImpl().hmacSHA256hex(cyphertext, remote.secret as string)
    
                        if (secureMessage.hmac === hmac) {
                            
                            let agent = this.pod?.getAgent(secureMessagePayload.agentId);
                            if (agent !== undefined) {
    
                                let event: SecureMessageReceivedEvent = { 
                                    type: SecureNetworkEventType.SecureMessageReceived,
                                    content: { 
                                        connId: connId,
                                        sender: secureMessagePayload.senderIdentityHash,
                                        recipient: secureMessage.identityHash,
                                        payload: secureMessagePayload.content
                                    } 
                                };

                                //console.log('received message:', event)

                                agent.receiveLocalEvent(event);
                            }
                        } else {
                            SecureNetworkAgent.logger.warning('HMAC mismatch on received message on connection ' + connId);
                        }
                    }
                }

                
                
            }

        };

    }

    shutdown() {
        
    }

    private sendAuthEvent(connId: ConnectionId, identityLocation: IdentityLocation, identityHash: Hash, status: IdentityAuthStatus, identity?: Identity) {

        let ev: ConnectionIdentityAuthEvent = {
            type: SecureNetworkEventType.ConnectionIdentityAuth,
            content: {
                connId: connId,
                identityLocation: identityLocation,
                identityHash: identityHash,
                identity: identity,
                status: status
            }
        };

        this.pod?.broadcastEvent(ev);

    }

    private sendIdentity(connId: ConnectionId, identity: Identity, identityHash?: Hash) {

        if (identityHash === undefined) {
            identityHash = identity.hash();
        }
        
        let content: SendIdentityMessage = {
            type: MessageType.SendIdentity,
            identityHash: identityHash,
            identity: identity.toLiteralContext()
        };

        SecureNetworkAgent.logger.trace('Sending id ' + identityHash + ' on ' + connId);

        this.sendControlMessage(connId, content);
    }

    private answerReceivedChallenge(connId: ConnectionId, identityHash: Hash, secretHash: Hash) {

        let content: AnswerChallengeMessage = {
            type: MessageType.AnswerChallenge,
            identityHash: identityHash,
            secretHash: secretHash
        };

        this.sendControlMessage(connId, content);
    }

    private sendIdentityRequest(connId: ConnectionId, identityHash: Hash) {

        let content: RequestIdentityMessage = {
            type: MessageType.RequestIdentity,
            identityHash: identityHash
        };

        this.sendControlMessage(connId, content);
    }

    private sendKnownIdentityChallenge(connId: ConnectionId, identityHash: Hash, encryptedSecret: Array<string>) {

        let content: SendChallengeMessage = {
            type: MessageType.SendChallenge,
            identityHash: identityHash,
            encrypedSecret: encryptedSecret
        };

        this.sendControlMessage(connId, content);
    }

    private sendChallengeResult(connId: ConnectionId, identityHash: Hash, verified: boolean) {

        let content: ChallengeResultMessage = { 
            type: MessageType.ChallengeResult,
            identityHash: identityHash,
            result: verified
        };

        this.sendControlMessage(connId, content);
    }
    
    private sendControlMessage(connId: ConnectionId, content: ControlMessage) {
        this.getNetworkAgent().sendMessage(connId, SecureNetworkAgent.Id, content);
    }

    private getOrCreateConnectionSecuredForSending(connId: ConnectionId, identityHash: Hash): ConnectionSecuredForSending {
        return this.getOneWaySecuredConnection(connId, identityHash, false, true) as ConnectionSecuredForSending;
    }

    private getOrCreateConnectionSecuredForReceiving(connId: ConnectionId, identityHash: Hash): ConnectionSecuredForReceiving {
        return this.getOneWaySecuredConnection(connId, identityHash, true, true) as ConnectionSecuredForReceiving;
    }

    private getConnectionSecuredForSending(connId: ConnectionId, identityHash: Hash): ConnectionSecuredForSending {
        return this.getOneWaySecuredConnection(connId, identityHash, false, false) as ConnectionSecuredForSending;
    }

    private getConnectionSecuredForReceiving(connId: ConnectionId, identityHash: Hash): ConnectionSecuredForReceiving {
        return this.getOneWaySecuredConnection(connId, identityHash, true, false) as ConnectionSecuredForReceiving;
    }

    private getOneWaySecuredConnection(connId: ConnectionId, identityHash: Hash, sender: boolean, create: boolean) {
        
        let key = OneWaySecuredConnection.encode(connId, identityHash);

        let map: Map<string, OneWaySecuredConnection>;

        if (sender) {
            map = this.localIdentities;
        } else {
            map = this.remoteIdentities;
        }

        let secured = map.get(key);

        if (create && secured === undefined) {
            if (sender) {
                secured = new ConnectionSecuredForReceiving(connId, identityHash);
            } else {
                secured = new ConnectionSecuredForSending(connId, identityHash);
            }
            secured.setTimeout(DEFAULT_TIMEOUT);
            
            map.set(key, secured);
        }

        return secured;
    }

    private getVerifiedIdentity(connId: ConnectionId, identityHash: Hash, local: boolean) : Identity | undefined {
        let sid = this.getOneWaySecuredConnection(connId, identityHash, local, false);

        let identity: Identity | undefined = undefined;

        if (sid !== undefined && sid.verified()) {
            identity = sid.identity;
        }

        return identity;
    }

    private removeIdentitiesForConnection(id: ConnectionId) {

        for(const verifiedIdentities of [this.remoteIdentities, this.localIdentities]) {

            const toRemove = new Array<string>();

            for (const [k, v] of verifiedIdentities.entries()) {
                if (v.connId === id) {
                    toRemove.push(k);
                }
            }

            for (const k of toRemove) {
                SecureNetworkAgent.logger.trace('Removing identity' + verifiedIdentities.get(k)?.identityHash + ' from connection ' + id + ': it is being closed.')
                verifiedIdentities.delete(k);
            }
        }

    }

    private getNetworkAgent() {
        return (this.pod as AgentPod).getAgent(NetworkAgent.AgentId) as NetworkAgent;
    }

}

export { SecureNetworkAgent as SecureNetworkAgent, SecureNetworkEventType, SecureMessageReceivedEvent, ConnectionIdentityAuthEvent, IdentityLocation, IdentityAuthStatus }