import { Store } from 'data/storage/Store';
import { HashedObject } from 'data/model/HashedObject';
import { HashedSet } from 'data/model';
import { Hash } from 'data/model/Hashing';
import { MutationOp } from 'data/model/MutationOp';

import { PeerId } from '../../swarm/Peer';
import { Swarm, Event, PeerMessage, Message } from '../../swarm/Swarm';

import { StateGossipAgent } from './StateGossipAgent';
import { StateAgent } from './StateAgent';
import { TerminalOpsState } from './TerminalOpsState';


enum TerminalOpsAgentMessageType {
    RequestState     = 'resuest-state',
    RequestOps       = 'request-ops',
    SendState        = 'send-state',
    SendOps          = 'send-ops'
};


interface RequestStateMessage {
    type: TerminalOpsAgentMessageType.RequestState,
    objectHash: Hash
}

interface RequestOpsMessage {
    type: TerminalOpsAgentMessageType.RequestOps,
    objectHash: Hash,
    opHashes: Array<Hash>
}

interface SendStateMessage {
    type: TerminalOpsAgentMessageType.SendState,
    objectHash: Hash,
    state: any
}

interface SendOpsMessage {
    type: TerminalOpsAgentMessageType.SendOps,
    objectHash: Hash,
    literals: any,
    opHashes: Array<Hash>
}

type TerminalOpsAgentMessage = RequestStateHashMessage | RequestStateMessage | RequestOpsMessage | 
                                  SendStateHashMessage |    SendStateMessage |    SendOpsMessage;


class TerminalOpsAgent implements StateAgent {

    objectHash: Hash;
    acceptedMutationOpClasses: Array<String>;

    swarm?: Swarm;
    gossipAgent?: StateGossipAgent;
    store: Store;

    state?: TerminalOpsState;
    stateHash?: Hash;

    opCallback: (opHash: Hash) => Promise<void>;

    opsToSend : Map<Hash, {destinations: Set<PeerId>, timestamp: number}>;
    opsToReceive : Map<Hash, number>;

    opShippingInterval: number;

    constructor(objectHash: Hash, store: Store, acceptedMutationOpClasses : Array<string>) {
        this.objectHash = objectHash;
        this.store = store;
        this.acceptedMutationOpClasses = acceptedMutationOpClasses;

        this.opCallback = async (opHash: Hash) => {
            let op = await this.store.load(opHash) as MutationOp;
            if (this.shouldAcceptMutationOp(op)) {
                await this.loadStoredState();  
            }
        };

        this.opsToSend = new Map();
        this.opsToReceive = new Map();

        this.opShippingInterval = window.setInterval(() => {
            let now = new Date().getTime();
            let outdated: Array<Hash> = [];
            for (const [hash, info] of this.opsToSend.entries()) {
                if (info.timestamp + 10 * 60 * 1000 > now) {
                    outdated.push(hash);
                }
            }
            for (const hash of outdated) {
                this.opsToSend.delete(hash);
            }
            outdated = [];
            for (const [hash, timestamp] of this.opsToReceive.entries()) {
                if (timestamp + 11 * 60 * 1000 > now) {
                    outdated.push(hash);
                }
            }
            for (const hash of outdated) {
                this.opsToReceive.delete(hash);
            }

        }, 500);

    }

    getId(): string {
        return 'terminal-ops-for-' + this.objectHash;
    }

    ready(swarm: Swarm): void {

        this.swarm = swarm;
        this.gossipAgent = swarm.getLocalAgent(StateGossipAgent.Id) as StateGossipAgent;
        this.loadStoredState();
        this.watchStoreForOps();
    }

    async receiveRemoteState(sender: PeerId, stateHash: Hash, state?: HashedObject | undefined): Promise<boolean> {
        
        if (state !== undefined) {
            let computedHash = state.hash();

            if (computedHash !== stateHash) {
                // TODO: report bad peer
                return false;
            } else {

                let peerTerminalOpsState = state as TerminalOpsState;
                
                let opsToFetch: Hash[] = [];

                let badOps = false;

                for (const opHash of (peerTerminalOpsState.terminalOps as HashedSet<Hash>).values()) {
                    let o = await this.store.load(opHash);

                    if (o === undefined) {
                        opsToFetch.push(opHash);
                    } else {
                        const op = o as MutationOp;

                        if (!this.shouldAcceptMutationOp(op)) {
                            badOps = true;
                        }
                    }
                }

                if (badOps) {
                    // report bad peer
                } else if (opsToFetch.length > 0) {
                    this.requestOps(sender, opsToFetch);
                }

                return opsToFetch.length > 0 && !badOps;
            }
        } else {
            if (stateHash !== this.stateHash) {
                this.requestState(sender);
            }
            return false;
        }
        
    }

    receiveLocalEvent(ev: Event): void {
        ev; //
    }

    receiveMessage(message: Message): void {
        message; //
    }

    receivePeerMessage(peerMessage: PeerMessage): void {
        let msg: TerminalOpsAgentMessage = peerMessage.content as TerminalOpsAgentMessage;
        
        if (msg.objectHash !== this.objectHash) {

            //TODO: report bad peer?

            return;
        }

        if (msg.type === TerminalOpsAgentMessageType.RequestState) {
            this.sendState(peerMessage.sourceId);
        } else if (msg.type === TerminalOpsAgentMessageType.RequestOps) {
            this.sendOrScheduleOps(peerMessage.sourceId, msg.opHashes);
        } else if (msg.type === TerminalOpsAgentMessageType.SendState) {
            const sendStateMsg = msg as SendStateMessage;
            let state = HashedObject.fromLiteral(sendStateMsg.state);
            this.receiveRemoteState(peerMessage.sourceId, state.hash(), state);
        } else if (msg.type === TerminalOpsAgentMessageType.SendOps) {
            // TODO: you need to check signatures here also, so FIXME
            
        }



    }

    watchStoreForOps() {
        this.store.watchReferences('target', this.objectHash, this.opCallback);
    }

    unwatchStoreForOps() {
        this.store.removeReferencesWatch('target', this.objectHash, this.opCallback);
    }

    getObjectHash(): string {
        return this.objectHash;
    }

    private async loadStoredState() : Promise<void> {
        const state = await this.getStoredState();
        const stateHash = state.hash();

        if (this.stateHash === undefined || this.stateHash !== stateHash) {
            this.state = state;
            this.stateHash = stateHash;
            this.gossipAgent?.localAgentStateUpdate(this.getId(), state);
        }

    }

    private async getStoredState(): Promise<HashedObject> {
        let terminalOpsInfo = await this.store.loadTerminalOpsForMutable(this.objectHash);

        if (terminalOpsInfo === undefined) {
            terminalOpsInfo = {terminalOps: []};
        }

        return TerminalOpsState.create(this.objectHash, terminalOpsInfo.terminalOps);
    }

    private requestStateHash(peerId: PeerId) {
        let msg: RequestStateHashMessage = {
            type: TerminalOpsAgentMessageType.RequestStateHash,
            objectHash: this.objectHash
        };

        this.sendTerminalOpsAgentMessage(peerId, msg);
    }

    private requestState(peerId: PeerId) {
        let msg: RequestStateMessage = {
            type: TerminalOpsAgentMessageType.RequestState,
            objectHash: this.objectHash
        };

        this.sendTerminalOpsAgentMessage(peerId, msg);
    }

    private requestOps(peerId: PeerId, ops: Array<Hash>) {
        let msg: RequestOpsMessage = {
            type: TerminalOpsAgentMessageType.RequestOps,
            objectHash: this.objectHash,
            opHashes: ops
        };

        this.sendTerminalOpsAgentMessage(peerId, msg);
    }

    private sendStateHash(peerId: PeerId) {
        let msg: SendStateHashMessage = {
            type: TerminalOpsAgentMessageType.SendStateHash,
            objectHash: this.objectHash,
            stateHash: this.stateHash as Hash
        }

        this.sendTerminalOpsAgentMessage(peerId, msg);
    }

    private sendState(peerId: PeerId) {
        let msg: SendStateMessage = {
            type: TerminalOpsAgentMessageType.SendState,
            objectHash: this.objectHash,
            state: this.state?.toLiteral()
        };

        this.sendTerminalOpsAgentMessage(peerId, msg);
    }

    private async sendOrScheduleOps(peerId: PeerId, opHashes: Array<Hash>) {

        let ops: Array<HashedObject> = [];

        for (const hash of opHashes) {
            let op = await this.store.load(hash);

            if (op === undefined) {
                this.addOpToSend(peerId, hash);
            } else {
                ops.push(op);
            }
        }

        if (ops.length > 0) {
            this.sendOps(peerId, ops);
        }

    }

    private async sendOps(peerId: PeerId, ops: Array<HashedObject>) {

        let literals: any = {};
        let opHashes: Array<Hash> = [];
        
        for (const op of ops) {

            if (this.shouldAcceptMutationOp(op as MutationOp)) {
                let ctx = op.toLiteralContext();
                for (const [hash, literal] of opCtx.literals.entries()) {
                    literals[hash] = literal;
                }
                opHashes.push(ctx.rootHash as Hash);
            }
        }

        if (opHashes.length > 0) {
            let msg: SendOpsMessage = {
                type: TerminalOpsAgentMessageType.SendOps,
                objectHash: this.objectHash,
                literals: literals,
                opHashes: opHashes
            }

            this.sendTerminalOpsAgentMessage(peerId, msg);
        }
    }

    sendTerminalOpsAgentMessage(destinationId: PeerId, msg: TerminalOpsAgentMessage) {

        let peerMessage : PeerMessage = {
            sourceId      : this.swarm?.getLocalPeer().getId() as PeerId,
            destinationId : destinationId,
            agentId       : this.getId(),
            content       : msg
        };

        this.swarm?.sendPeerMessage(peerMessage);
    }

    private shouldAcceptMutationOp(op: MutationOp): boolean {

        return this.objectHash === op.target?.hash() &&
               this.acceptedMutationOpClasses.indexOf(op.getClassName()) >= 0;
    }

    private addOpToSend(peerId: PeerId, hash: Hash) {
        let info = this.opsToSend.get(hash);

        let now = new Date().getTime();
        if (info === undefined) {
            let destinations: Set<PeerId> = new Set();
            destinations.add(peerId);
            this.opsToSend.set(hash, {destinations: destinations, timestamp: now});
        } else {
            info.destinations.add(peerId);
            info.timestamp = now;
        }
    }

    private removeOpToSend(hash: Hash) {
        this.opsToReceive.delete(hash);
    }

    private addOpToReceive(hash: Hash) {
        this.opsToReceive.set(hash, new Date().getTime());
    }

    private removeOpToReceive(hash: Hash) {
        this.opsToReceive.delete(hash);
    }
    
}

export { TerminalOpsAgent };