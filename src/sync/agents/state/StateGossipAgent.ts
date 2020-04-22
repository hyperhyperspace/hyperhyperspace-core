import { Swarm, Event, Agent, Message, PeerMessage } from '../../swarm';
import { AgentId } from '../../swarm/Agent';
import { EventType } from '../../swarm/Swarm';
import { PeerId } from '../../swarm/Peer';

import { StateAgent } from '../../agents/state/StateAgent';

import { HashedMap } from 'data/model/HashedMap';
import { Hash, HashedObject } from 'data/model';
import { Shuffle } from 'util/shuffling';

enum GossipType {
    SendFullState    = 'send-full-state',
    SendStateUpdate  = 'send-state-update',
    RequestFullState = 'request-full-state'
};

interface SendFullStateMessage { 
    type: GossipType.SendFullState,
    state: HashedMap<AgentId, Hash>,
};

interface SendStateUpdate {
    type      : GossipType.SendStateUpdate,
    agentId   : AgentId,
    state     : any,
    hops      : number,
    timestamp : number
};

interface RequestFullState {
    type: GossipType.RequestFullState
}

type GossipMessage = SendFullStateMessage | SendStateUpdate | RequestFullState;

type GossipParams = { 
    minPeersPerAgent: number, 
    maxCachedPrevStates: number,
    newStateErrorRetries: number,
    newStateErrorDelay: number
 };

type PeerState = Map<AgentId, Hash>;

class StateGossipAgent implements Agent {

    static Id = 'state-gossip-agent';

    // tunable working parameters

    params: GossipParams = {
        minPeersPerAgent: 3,
        maxCachedPrevStates: 50,
        newStateErrorRetries: 3,
        newStateErrorDelay: 1500
    };


    swarm?: Swarm;

    localState: PeerState;

    remoteState: Map<PeerId, PeerState>;

    previousStatesCache: Map<AgentId, Array<Hash>>;

    constructor() {

        this.localState  = new Map();
        this.remoteState = new Map();

        this.previousStatesCache = new Map();
    }

    getId(): string {
        return StateGossipAgent.Id;
    }

    getSwarm() : Swarm {
        return this.swarm as Swarm;
    }

    ready(swarm: Swarm): void {
        this.swarm = swarm;

        
    }

    localAgentStateUpdate(agentId: AgentId, state: HashedObject) {

        const hash = state.hash();

        const shouldGossip = ! this.stateIsInPreviousCache(agentId, hash);

        const currentState = this.localState.get(agentId);

        if (currentState !== undefined && hash !== currentState) {
            this.cachePreviousState(agentId, currentState);
        }

        this.localState.set(agentId, hash);
       
        if (shouldGossip) {
            this.gossipNewState(agentId, state);
        }
    }

    dropAgentState(agentId: AgentId) {
        this.clearState(agentId);
    }

    receiveLocalEvent(ev: Event): void {
        if (ev.type = EventType.LocalAgentRemoval) {
            this.dropAgentState(ev.content as AgentId);
        }
    }

    private clearState(agentId: AgentId) {
        this.localState.delete(agentId);
        this.previousStatesCache.delete(agentId);
    }


    // cached states start at the front of the array and are
    // shifted right as new states to cache arrive.

    private cachePreviousState(agentId: AgentId, state: Hash) {

        let prevStates = this.previousStatesCache.get(agentId);

        if (prevStates === undefined) {
            prevStates = [];
            this.previousStatesCache.set(agentId, prevStates);
        }

        // remove if already cached
        let idx = prevStates.indexOf(state);
        if (idx >= 0) {
            prevStates.splice(idx, 1);
        }

        // truncate array to make room for new state
        const maxLength = this.params.maxCachedPrevStates - 1;
        if (prevStates.length > maxLength) {
            const toDelete = prevStates.length - maxLength;
            prevStates.splice(maxLength, toDelete);
        }

        // put state at the start of the cached states array
        prevStates.unshift(state);

    }

    private gossipNewState(agentId: AgentId, state: HashedObject, hops=0, timestamp?: number) {


        const peerIds = Array.from(this.getSwarm().getConnectedPeersWithAgent(agentId));

        const count = Math.ceil(peerIds.length / Math.pow(2, hops));

        if (timestamp === undefined) {
            timestamp = new Date().getTime();
        }

        Shuffle.array(peerIds);

        for (let i=0; i<count; i++) {
            //console.log(this.swarm?.localPeer?.getId() + ' is gossiping to ' + peerIds[i] + ' state ' + state.hash() + ' for ' + agentId);
            this.sendStateUpdate(peerIds[i], agentId, state, hops, timestamp);
        }
    }

    private async notifyAgentOfStateArrival(sender: PeerId, agentId: AgentId, stateHash: Hash, state?: HashedObject) : Promise<boolean> {

        const agent = this.getLocalStateAgent(agentId);

        let isNew = false;
        let valueReady = false;

        if (agent !== undefined) {
            const stateAgent = agent as StateAgent;
            
            try {
                isNew = await stateAgent.receiveRemoteState(sender, stateHash, state);
                valueReady = true;
            } catch (e) {
                let retries=0;
                while (valueReady === false && retries < this.params.newStateErrorRetries) {
                    await new Promise(r => setTimeout(r, this.params.newStateErrorDelay));
                    isNew = await stateAgent.receiveRemoteState(sender, stateHash, state);
                    valueReady = true;
                }
            }

            if (valueReady) {
                return isNew;
            } else {
                return false;
            }
            
        } else {
            return false;
        }

    }

    stateIsInPreviousCache(agentId: AgentId, state: Hash) {
        const cache = this.previousStatesCache.get(agentId);
        return (cache !== undefined) && cache.indexOf(state) >= 0;
    }

    receiveMessage(_message: Message): void {
        
    }

    sendFullSate(peerId: PeerId) {
        let fullStateMessage: SendFullStateMessage = { 
            type  : GossipType.SendFullState,
            state : new HashedMap<AgentId, Hash>(this.localState.entries())
        };

        let peerMessage : PeerMessage = { 
            sourceId      : this.swarm?.getLocalPeer().getId() as PeerId,
            destinationId : peerId,
            agentId       : this.getId(),
            content       : fullStateMessage

        };

        this.swarm?.sendPeerMessage(peerMessage);
    }

    sendStateUpdate(peerId: PeerId, agentId: AgentId, state: HashedObject, hops: number, timestamp: number) {
        
        let literal = state.toLiteral();
        
        let stateUpdateMessage : SendStateUpdate = {
            type      : GossipType.SendStateUpdate,
            agentId   : agentId,
            state     : literal,
            hops      : hops,
            timestamp : timestamp
        };

        let peerMessage : PeerMessage = {
            sourceId      : this.swarm?.getLocalPeer().getId() as PeerId,
            destinationId : peerId,
            agentId       : this.getId(),
            content       : stateUpdateMessage
        };

        this.swarm?.sendPeerMessage(peerMessage);
    }

    receivePeerMessage(message: PeerMessage): void {
        const gossip = message.content as GossipMessage;

        if (gossip.type === GossipType.SendFullState) {
            this.receiveFullState(message.sourceId, new Map(gossip.state.entries()));
        }

        if (gossip.type === GossipType.SendStateUpdate) {

            let state = HashedObject.fromLiteral(gossip.state);

            this.receiveStateUpdate(message.sourceId, gossip.agentId, state, gossip.hops, gossip.timestamp);
        }

        if (gossip.type === GossipType.RequestFullState) {
            this.sendFullSate(message.sourceId);
        }
    }

    private getLocalStateAgent(agentId: AgentId) {

        const agent = this.getSwarm().getLocalAgent(agentId);

        if (agent !== undefined && 'receiveRemoteState' in agent) {
            return agent;
        } else {
            return undefined;
        }
    }

    private receiveFullState(sender: PeerId, state: PeerState) {

        for(const [agentId, hash] of state.entries()) {
            const agent = this.getLocalStateAgent(agentId);

            if (agent !== undefined) {

                const currentState = this.localState.get(agentId);

                if (currentState !== hash) {
                    const cacheHit = this.stateIsInPreviousCache(agentId, hash);
                    if (! cacheHit) {
                        this.cachePreviousState(agentId, hash);
                        this.notifyAgentOfStateArrival(sender, agentId, hash);

                        // I _think_ it's better to not gossip in this case.
                    }
                }
            }
        }

    }

    private async receiveStateUpdate(sender: PeerId, agentId: AgentId, state: HashedObject, hops: number, timestamp: number) {

        const hash = state.hash();
        const cacheHit = this.stateIsInPreviousCache(agentId, state.hash());

        if (!cacheHit) {
            this.cachePreviousState(agentId, hash);
            const shouldGossip = await this.notifyAgentOfStateArrival(sender, agentId, hash, state);

            if (shouldGossip) {
                this.gossipNewState(agentId, state, hops+1, timestamp);
            }
        }

    }

}

export { StateGossipAgent };