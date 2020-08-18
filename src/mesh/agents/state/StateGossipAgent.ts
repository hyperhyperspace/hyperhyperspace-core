import { StateSyncAgent } from '../state/StateSyncAgent';
import { PeeringAgent } from '../peer/PeeringAgent';
import { SecureMessageReceivedEvent, SecureNetworkEventType } from '../network/SecureNetworkAgent';

import { AgentPod, Event, AgentSetChangeEvent, AgentSetChange, AgentPodEventType } from '../../service/AgentPod';
import { AgentId } from '../../service/Agent';
import { Endpoint } from '../network/NetworkAgent';
//import { PeerId } from '../../network/Peer';

import { HashedMap } from 'data/model/HashedMap';
import { Hash, HashedObject } from 'data/model';
import { Shuffle } from 'util/shuffling';
import { Logger, LogLevel } from 'util/logging';
import { PeerGroupAgent, PeerMeshEventType, NewPeerEvent } from '../peer/PeerGroupAgent';


enum GossipType {
    SendFullState    = 'send-full-state',
    SendStateUpdate  = 'send-state-update',
    RequestFullState = 'request-full-state'
};

interface SendFullStateMessage { 
    type: GossipType.SendFullState,
    state: {entries: [AgentId, Hash][], hashes: Hash[]} //HashedMap<AgentId, Hash>.toArrays
};

interface SendStateUpdate {
    type      : GossipType.SendStateUpdate,
    agentId   : AgentId,
    state     : any,
    timestamp : number
};

interface RequestFullState {
    type: GossipType.RequestFullState
}

type GossipMessage = SendFullStateMessage | SendStateUpdate | RequestFullState;

type GossipParams = { 
    peerGossipFraction   : number,
    peerGossipProb       : number,
    minGossipPeers       : number,
    maxCachedPrevStates  : number,
    newStateErrorRetries : number,
    newStateErrorDelay   : number,
    maxGossipDelay       : number
 };

type PeerState = Map<AgentId, Hash>;

enum GossipEventTypes {
    AgentStateUpdate = 'agent-state-update'
};

type AgentStateUpdateEvent = {
    type: GossipEventTypes.AgentStateUpdate,
    content: { agentId: AgentId, state: HashedObject }
}

class StateGossipAgent extends PeeringAgent {

    static agentIdForGossip(gossipId: string) {
        return 'state-gossip-agent-for-' + gossipId;
    }

    static peerMessageLog = new Logger(StateGossipAgent.name, LogLevel.INFO);
    static controlLog     = new Logger(StateGossipAgent.name, LogLevel.INFO);

    // tunable working parameters

    params: GossipParams = {
        peerGossipFraction   : 0.2,
        peerGossipProb       : 0.5,
        minGossipPeers       : 4,
        maxCachedPrevStates  : 50,
        newStateErrorRetries : 3,
        newStateErrorDelay   : 1500,
        maxGossipDelay       : 5000
    };

    gossipId: string;

    pod?: AgentPod;

    trackedAgentIds: Set<AgentId>;
    localState: PeerState;

    remoteState: Map<Endpoint, PeerState>;

    previousStatesCache: Map<AgentId, Array<Hash>>;

    peerMessageLog = StateGossipAgent.peerMessageLog;
    controlLog     = StateGossipAgent.controlLog;

    constructor(topic: string, peerNetwork: PeerGroupAgent) {
        super(peerNetwork);
        this.gossipId = topic;

        this.trackedAgentIds = new Set();
        this.localState  = new Map();
        this.remoteState = new Map();

        this.previousStatesCache = new Map();
    }

    getAgentId(): string {
        return StateGossipAgent.agentIdForGossip(this.gossipId);
    }

    getNetwork() : AgentPod {
        return this.pod as AgentPod;
    }

    ready(pod: AgentPod): void {
        this.pod = pod;
        this.controlLog.debug('Agent ready');
    }

    trackAgentState(agentId: AgentId) {
        this.trackedAgentIds.add(agentId);
    }

    untrackAgentState(agentId: AgentId) {
        this.trackedAgentIds.delete(agentId);
        this.previousStatesCache.delete(agentId);
        this.localState.delete(agentId);
    }

    isTrackingState(agentId: AgentId) {
        return this.trackedAgentIds.has(agentId);
    }

    localAgentStateUpdate(agentId: AgentId, state: HashedObject) {

        if (this.trackedAgentIds.has(agentId)) {
            const hash = state.hash();

            const shouldGossip = ! this.stateIsInPreviousCache(agentId, hash);
    
            const currentState = this.localState.get(agentId);
    
            if (currentState !== undefined && hash !== currentState) {
                this.cachePreviousState(agentId, currentState);
            }
    
            this.localState.set(agentId, hash);
           
            if (shouldGossip) {
                this.controlLog.trace('Gossiping state ' + hash + ' from ' + this.peerGroupAgent.getLocalPeer().endpoint);
                this.gossipNewState(agentId, state);
            } else {
                this.controlLog.trace('NOT gossiping state ' + hash + ' from ' + this.peerGroupAgent.getLocalPeer().endpoint);
            }
        }

    }

    dropAgentState(agentId: AgentId) {
        this.clearState(agentId);
    }

    receiveLocalEvent(ev: Event): void {

        if (ev.type === AgentPodEventType.AgentSetChange) {
            
            let changeEv = ev as AgentSetChangeEvent;

            if (changeEv.content.change === AgentSetChange.Removal) {
                this.dropAgentState(changeEv.content.agentId);
            }   
        } else if (ev.type === SecureNetworkEventType.SecureMessageReceived) {
            
            let secMsgEv = ev as SecureMessageReceivedEvent;

            // TODO: validate if the secure message comes from who it should,
            //       uses the right credentials, etc

            let gossipMsg = secMsgEv.content.payload as GossipMessage;

            this.receiveGossip(secMsgEv.content.sender, gossipMsg);
        } else if (ev.type === GossipEventTypes.AgentStateUpdate) {
            
            let updateEv = ev as AgentStateUpdateEvent;

            this.localAgentStateUpdate(updateEv.content.agentId, updateEv.content.state);
        } else if (ev.type === PeerMeshEventType.NewPeer) {
            let newPeerEv = ev as NewPeerEvent;

            if (newPeerEv.content.peerGroupId === this.peerGroupAgent.peerGroupId) {
                this.controlLog.trace(this.peerGroupAgent.localPeer.endpoint + ' detected new peer: ' + newPeerEv.content.peer.endpoint)
                this.sendFullState(newPeerEv.content.peer.endpoint);
            }
            
        }
    }

    receivePeerMessage(source: Endpoint, sender: Hash, recipient: Hash, content: any): void {
        sender; recipient;
        this.receiveGossip(source, content as GossipMessage);
    }

    private clearState(agentId: AgentId) {
        this.localState.delete(agentId);
        this.previousStatesCache.delete(agentId);
    }

    shutdown() {
        
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

    private gossipNewState(agentId: AgentId, state: HashedObject, sender?: Endpoint, timestamp?: number) {


        const peers = this.getPeerControl().getPeers();

        let count = Math.ceil(this.getPeerControl().params.maxPeers * this.params.peerGossipFraction);

        if (count < this.params.minGossipPeers) {
            count = this.params.minGossipPeers;
        }

        if (count > peers.length) {
            count = peers.length;
        }


        if (timestamp === undefined) {
            timestamp = new Date().getTime();
        }

        Shuffle.array(peers);

        this.controlLog.trace('Gossiping state to ' + count + ' peers on ' + this.peerGroupAgent.getLocalPeer().endpoint);

        for (let i=0; i<count; i++) {
            if (sender === undefined || sender !== peers[i].endpoint) {
                try {
                    this.sendStateUpdate(peers[i].endpoint, agentId, state, timestamp);
                } catch (e) {
                    this.peerMessageLog.debug('Could not gossip message to ' + peers[i].endpoint + ', send failed with: ' + e);
                }
                
            }   
        }
    }

    private async notifyAgentOfStateArrival(sender: Endpoint, agentId: AgentId, stateHash: Hash, state?: HashedObject) : Promise<boolean> {

        const agent = this.getLocalStateAgent(agentId);

        let isNew = false;
        let valueReady = false;

        if (agent !== undefined) {
            const stateAgent = agent as StateSyncAgent;
            
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
                throw new Error('Error processing remote state.');
            }
            
        } else {
            throw new Error('Cannot find receiving agent.');
        }

    }

    stateIsInPreviousCache(agentId: AgentId, state: Hash) {
        const cache = this.previousStatesCache.get(agentId);
        return (cache !== undefined) && cache.indexOf(state) >= 0;
    }

    sendFullState(ep: Endpoint) {

        let fullStateMessage: SendFullStateMessage = { 
            type  : GossipType.SendFullState,
            state : new HashedMap<AgentId, Hash>(this.localState.entries()).toArrays()
        };

        this.sendMessageToPeer(ep, this.getAgentId(), fullStateMessage);
    }

    sendStateUpdate(peerEndpoint: Endpoint, agentId: AgentId, state: HashedObject, timestamp: number) {
        
        let literal = state.toLiteral();
        
        let stateUpdateMessage : SendStateUpdate = {
            type      : GossipType.SendStateUpdate,
            agentId   : agentId,
            state     : literal,
            timestamp : timestamp
        };

        this.peerMessageLog.debug('Sending state for ' + agentId + ' from ' + this.peerGroupAgent.getLocalPeer().endpoint + ' to ' + peerEndpoint);
        let result = this.sendMessageToPeer(peerEndpoint, this.getAgentId(), stateUpdateMessage);

        if (!result) {
            this.controlLog.debug('Sending state failed!');
        }
    }

    private receiveGossip(source: Endpoint, gossip: GossipMessage): void {

        this.peerMessageLog.debug(this.getPeerControl().getLocalPeer().endpoint + ' received ' + gossip.type + ' from ' + source);

        if (gossip.type === GossipType.SendFullState) {
            let state = new HashedMap<AgentId, Hash>();
            state.fromArrays(gossip.state.hashes, gossip.state.entries);
            this.receiveFullState(source, new Map(state.entries()));
        }

        if (gossip.type === GossipType.SendStateUpdate) {

            let state = HashedObject.fromLiteral(gossip.state);

            this.receiveStateUpdate(source, gossip.agentId, state, gossip.timestamp);
        }

        if (gossip.type === GossipType.RequestFullState) {
            this.sendFullState(source);
        }
    }

    private getLocalStateAgent(agentId: AgentId) {

        const agent = this.getNetwork().getAgent(agentId);

        if (agent !== undefined && 'receiveRemoteState' in agent) {
            return agent;
        } else {
            return undefined;
        }
    }

    private receiveFullState(sender: Endpoint, state: PeerState) {

        for(const [agentId, hash] of state.entries()) {

            if (this.trackedAgentIds.has(agentId)) {
                const agent = this.getLocalStateAgent(agentId);

                if (agent !== undefined) {
    
                    const currentState = this.localState.get(agentId);
    
                    if (currentState !== hash) {
                        const cacheHit = this.stateIsInPreviousCache(agentId, hash);
                        if (! cacheHit) {
                            this.cachePreviousState(agentId, hash);
                            try {
                                this.notifyAgentOfStateArrival(sender, agentId, hash);
                            } catch (e) {
                                //FIXME
                            }
                            
    
                            // I _think_ it's better to not gossip in this case.
                        }
                    }
                }
            }

        }

    }

    private async receiveStateUpdate(sender: Endpoint, agentId: AgentId, state: HashedObject, timestamp: number) {

        const hash = state.hash();
        const cacheHit = this.stateIsInPreviousCache(agentId, state.hash());

        let receivedOldState = cacheHit;

        if (!cacheHit) {
            
            try {
                let shouldGossip = await this.notifyAgentOfStateArrival(sender, agentId, hash, state);
                // if the state is valid, cache
                this.cachePreviousState(agentId, hash);

                if (shouldGossip) {
                    if (Math.random() < this.params.peerGossipProb) {
                        this.peerMessageLog.trace('gossiping...');
                        this.gossipNewState(agentId, state, sender, timestamp);
                    }
                } else {
                    receivedOldState = true;
                }
            } catch (e) {
                // maybe cache erroneous states so we don't process them over and over?
            }

        }

        if (receivedOldState) {
            this.peerMessageLog.trace('Received old state for ' + agentId + ' from ' + sender + ', sending our own state over there.');
            (this.pod?.getAgent(agentId) as StateSyncAgent)?.sendState(sender);
        }

    }

}

export { StateGossipAgent, AgentStateUpdateEvent, GossipEventTypes };