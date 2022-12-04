import { StateSyncAgent } from '../state/StateSyncAgent';
import { PeeringAgentBase } from '../peer/PeeringAgentBase';

import { AgentPod, AgentEvent, AgentSetChangeEvent, AgentSetChange, AgentPodEventType } from '../../service/AgentPod';
import { AgentId } from '../../service/Agent';
import { Endpoint } from '../network/NetworkAgent';

import { HashedMap } from 'data/model/immutable';
import { Hash, HashedObject } from 'data/model';
import { Shuffle } from 'util/shuffling';
import { Logger, LogLevel } from 'util/logging';
import { PeerGroupAgent, PeerMeshEventType, NewPeerEvent, LostPeerEvent } from '../peer/PeerGroupAgent';
import { LRUCache } from 'util/caching';


/*
 * A gossip agent is created with a given gossipId (these usually match 1-to-1
 * with peerGroupIds), and then is instructed to gossip about the state reported
 * by other agents (this.trackedAgentIds keeps track of which ones).
 * 
 * Each agent's state is represented by a HashedObject, and thus states can be
 * hashed and hashes sent over to quickly assess if a remote and a local instance
 * of the same agent are in the same state.
 * 
 * All the tracked agents must implement the StateSyncAgent interface. They are 
 * expected to spew an AgentStateUpdate event on the bus whenever they enter a
 * new state, and to receive a state that was picked up via gossip when their
 * receiveRemoteState() method is invoked.
 * 
 * The gossip agents on different nodes exchange messages about two things:
 * 
 *   - They can ask for (SendFullState message) or send (SendFullState message) the 
 *     set of hashes of the states of all the agents being tracked.
 * 
 *   - They can ask for (RequestStateObject) or send (SendStateObject) the object
 *     representing the state of a given agent.
 *   
 *
 * A gossip agent follows these simple rules:
 * 
 *   - On startup it will send the hashes of the states of all the tracked agents 
 *     to all connected peers. Whenever a new peer is detected, it'll send it the 
 *     hashes as well.
 * 
 *   - Upon receiving a set of hashes of states from a peer, they'll see if they are 
 *     tracking the state of any of them, and if the states differ the corresponding
 *     object states will be asked for (*).
 * 
 *   - When a local agent advertises through the bus it is entering a new state by
 *     emitting the AgentStateUpdate event, any gossip agents tracking its state will
 *     gossip the new state object to all their peers.
 * 
 *   - Upon receiving a new state object for an agent whose state it is tracking, a
 *     gossip agent will invoke the receiveRemoteState() method of the corresponding
 *     agent, and learn whether this state is new or known. If it is known, it'll
 *     assume the agent on the peer has an old state, and it will send the state
 *     object of the local agent in response.
 *     
 *     (*) If the received state hash matches that of the state of another peer for 
 *         that same agent, the asking step is skipped and that state object is used 
 *         instead.         
 */

enum GossipType {
    SendFullState      = 'send-full-state',
    SendStateObject    = 'send-state-object',
    RequestFullState   = 'request-full-state',
    RequestStateObject = 'request-state-object'
};

interface SendFullState { 
    type: GossipType.SendFullState,
    state: {entries: [AgentId, Hash][], hashes: Hash[]}
};

interface SendStateObject {
    type      : GossipType.SendStateObject,
    agentId   : AgentId,
    state     : any,
    timestamp : number
};

interface RequestFullState {
    type: GossipType.RequestFullState
}

interface RequestStateObject {
    type    : GossipType.RequestStateObject,
    agentId : AgentId
}

type GossipMessage = SendFullState | SendStateObject | RequestFullState | RequestStateObject;

type GossipParams = { 
    peerGossipFraction     : number,
    peerGossipProb         : number,
    minGossipPeers         : number,
    maxCachedPrevStates    : number,
    newStateErrorRetries   : number,
    newStateErrorDelay     : number,
    maxStateSendingRepeats : number,
    maxStateSendingFreq    : number,
    maxGossipDelay         : number
 };

type PeerState = Map<AgentId, Hash>;

enum GossipEventTypes {
    AgentStateUpdate = 'agent-state-update'
};

type AgentStateUpdateEvent = {
    type: GossipEventTypes.AgentStateUpdate,
    content: { agentId: AgentId, state: HashedObject }
}

enum SendingReason {
    Gossip = 'gossip',
    Request = 'request'
};

class StateGossipAgent extends PeeringAgentBase {

    static agentIdForGossipId(gossipId: string) {
        return 'state-gossip-agent-for-' + gossipId;
    }

    static peerMessageLog = new Logger(StateGossipAgent.name, LogLevel.INFO);
    static controlLog     = new Logger(StateGossipAgent.name, LogLevel.INFO);

    // tunable working parameters

    params: GossipParams = {
        peerGossipFraction     : 0.2,
        peerGossipProb         : 0.5,
        minGossipPeers         : 4,
        maxCachedPrevStates    : 50,
        newStateErrorRetries   : 3,
        newStateErrorDelay     : 1500,
        maxStateSendingRepeats : 100,
        maxStateSendingFreq    : 5,
        maxGossipDelay         : 5000
    };

    gossipId: string;

    pod?: AgentPod;

    trackedAgentIds: Set<AgentId>;
    localState: PeerState;
    remoteState: Map<Endpoint, PeerState>;

    localStateObjects: Map<AgentId, HashedObject>;
    remoteStateObjects: Map<Endpoint, Map<AgentId, HashedObject>>;

    previousStatesCaches: Map<AgentId, LRUCache<Hash, HashedObject>>;

    sentStateCache: LRUCache<string, {timestamp: number, stateHash: Hash, repeats: number}>;

    //stateRequestRetryInterval?: any; // disabled for now

    peerMessageLog = StateGossipAgent.peerMessageLog;
    controlLog     = StateGossipAgent.controlLog;

    

    constructor(gossipId: string, peerNetwork: PeerGroupAgent) {
        super(peerNetwork);
        this.gossipId = gossipId;

        this.trackedAgentIds = new Set();
        this.localState  = new Map();
        this.remoteState = new Map();

        this.localStateObjects = new Map();
        this.remoteStateObjects = new Map();

        this.previousStatesCaches = new Map();

        this.sentStateCache = new LRUCache(512);

        /*this.stateRequestRetryInterval = setInterval(() => {

            for (const agentId of this.trackedAgentIds) {                
                for (const peer of this.getPeerControl().getPeers()) {
                    if (this.remoteState.get(peer.endpoint)?.get(agentId) === undefined) {
                        this.requestStateObject(peer.endpoint, agentId);
                        console.log('state hash of ' + agentId + ' was missing from ' + peer.endpoint + ', it was requested');
                    }
                }
            }

            for (const [ep, peerState] of this.remoteState.entries()) {

                console.log('checking peer ' + ep);

                const stateObjects = this.remoteStateObjects.get(ep);

                for (const [agentId, hash] of peerState.entries()) {
                    const fetchedStateHash = stateObjects?.get(agentId)?.getLastHash();
                    console.log('checking ' + agentId + ', discovered state=' + hash + ', fetched state=' + fetchedStateHash);

                    if (fetchedStateHash !== hash) {
                        console.log('REQUESTING')
                        this.requestStateObject(ep, agentId);
                    }
                }
            }

        }, 15000);*/
    }

    getAgentId(): string {
        return StateGossipAgent.agentIdForGossipId(this.gossipId);
    }

    getNetwork() : AgentPod {
        return this.pod as AgentPod;
    }

    // gossip agent control:

    ready(pod: AgentPod): void {
        this.pod = pod;
        this.controlLog.debug('Agent ready');
    }

    trackAgentState(agentId: AgentId) {
        this.trackedAgentIds.add(agentId);

        this.requestStateObjectToAllPeers(agentId);
    }

    untrackAgentState(agentId: AgentId) {
        this.trackedAgentIds.delete(agentId);
        this.previousStatesCaches.delete(agentId);
        this.localState.delete(agentId);
        this.localStateObjects.delete(agentId);
    }

    isTrackingState(agentId: AgentId) {
        return this.trackedAgentIds.has(agentId);
    }

    shutdown() {
        
    }

    // public functions, exposing states heard through gossip

    getRemoteState(ep: Endpoint, agentId: AgentId): Hash|undefined {
        return this.remoteState.get(ep)?.get(agentId);
    }

    getRemoteStateObject(ep: Endpoint, agentId: AgentId): HashedObject|undefined {
        return this.remoteStateObjects.get(ep)?.get(agentId);
    }

    // local events listening

    receiveLocalEvent(ev: AgentEvent): void {

        if (ev.type === AgentPodEventType.AgentSetChange) {
            
            let changeEv = ev as AgentSetChangeEvent;

            if (changeEv.content.change === AgentSetChange.Removal) {
                this.clearAgentState(changeEv.content.agentId)
            }   
        } else if (ev.type === GossipEventTypes.AgentStateUpdate) {
            
            let updateEv = ev as AgentStateUpdateEvent;
            this.localAgentStateUpdate(updateEv.content.agentId, updateEv.content.state);

        } else if (ev.type === PeerMeshEventType.NewPeer) {
            
            let newPeerEv = ev as NewPeerEvent;
            if (newPeerEv.content.peerGroupId === this.peerGroupAgent.peerGroupId) {
                this.controlLog.trace(this.peerGroupAgent.localPeer.endpoint + ' detected new peer: ' + newPeerEv.content.peer.endpoint)
                this.sendFullState(newPeerEv.content.peer.endpoint);
            }
            
        } else if (ev.type === PeerMeshEventType.LostPeer) {
            let lostPeerEv = ev as LostPeerEvent;

            if (lostPeerEv.content.peerGroupId === this.peerGroupAgent.peerGroupId) {
                this.controlLog.trace(this.peerGroupAgent.localPeer.endpoint + ' lost a peer: ' + lostPeerEv.content.peer.endpoint)
                this.clearPeerState(lostPeerEv.content.peer.endpoint);
            }
        }
    }

    // incoming messages

    receivePeerMessage(source: Endpoint, sender: Hash, recipient: Hash, content: any): void {
        sender; recipient;
        this.receiveGossip(source, content as GossipMessage);
    }

    private clearAgentState(agentId: AgentId) {
        this.localState.delete(agentId);
        this.localStateObjects.delete(agentId);
        this.previousStatesCaches.delete(agentId);
    }

    private clearPeerState(endpoint: Endpoint) {
        this.remoteState.delete(endpoint);
        this.remoteStateObjects.delete(endpoint);
    }

    // Gossiping and caching of local states:

    // cached states start at the front of the array and are
    // shifted right as new states to cache arrive.

    private localAgentStateUpdate(agentId: AgentId, state: HashedObject) {

        if (this.trackedAgentIds.has(agentId)) {
            const hash = state.hash();

            const currentState = this.localState.get(agentId);
    
            if (currentState !== undefined && hash !== currentState) {
                this.cachePreviousState(agentId, currentState, this.localStateObjects.get(agentId) as HashedObject);
            }
    
            this.localState.set(agentId, hash);
            this.localStateObjects.set(agentId, state);
           
            this.controlLog.trace('Gossiping state ' + hash + ' from ' + this.peerGroupAgent.getLocalPeer().endpoint);
            this.gossipNewState(agentId);
        }

    }

    private gossipNewState(agentId: AgentId, sender?: Endpoint, timestamp?: number) {

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
                    this.sendStateObject(peers[i].endpoint, agentId);
                } catch (e) {
                    this.peerMessageLog.debug('Could not gossip message to ' + peers[i].endpoint + ', send failed with: ' + e);
                }
                
            }   
        }
    }

    private requestStateObjectToAllPeers(agentId: AgentId) {

        const peers = this.getPeerControl().getPeers();

        this.controlLog.trace('Requesting state object for ' + agentId + ' to ' + peers.length + ' peers on ' + this.peerGroupAgent.getLocalPeer().endpoint);

        for (const peer of peers.values()) {
                try {
                    this.requestStateObject(peer.endpoint, agentId);
                } catch (e) {
                    this.peerMessageLog.debug('Could not request state object from ' + peer.endpoint + ', send failed with: ' + e);
                }
        }
    }

    private cachePreviousState(agentId: AgentId, stateHash: Hash, stateObj: HashedObject) {

        let prevStates = this.previousStatesCaches.get(agentId);

        if (prevStates === undefined) {
            prevStates = new LRUCache(this.params.maxCachedPrevStates);
            this.previousStatesCaches.set(agentId, prevStates);
        }

        prevStates.set(stateHash, stateObj);
    }

    private getStateFromPreviousCache(agentId: AgentId, stateHash: Hash): HashedObject|undefined {
        return this.previousStatesCaches.get(agentId)?.get(stateHash);
    }

    // handling and caching of remote states

    private setRemoteState(ep: Endpoint, agentId: AgentId, state: Hash, stateObject: HashedObject) {

        let peerState = this.remoteState.get(ep);
        if (peerState === undefined) {
            peerState = new Map();
            this.remoteState.set(ep, peerState);
        }

        peerState.set(agentId, state);

        let peerStateObjects = this.remoteStateObjects.get(ep);
        if (peerStateObjects === undefined) {
            peerStateObjects = new Map();
            this.remoteStateObjects.set(ep, peerStateObjects);
        }

        peerStateObjects.set(agentId, stateObject);
    }

    private lookupStateObject(agentId: AgentId, state: Hash) {
        for (const [ep, peerState] of this.remoteState.entries()) {
            if (peerState.get(agentId) === state) {
                const stateObj = this.remoteStateObjects.get(ep)?.get(agentId);
                if (stateObj !== undefined) {
                    return stateObj
                }
            }
        }

        return undefined;
    }


    private receiveGossip(source: Endpoint, gossip: GossipMessage): void {

        this.peerMessageLog.debug(this.getPeerControl().getLocalPeer().endpoint + ' received ' + gossip.type + ' from ' + source);

        if (gossip.type === GossipType.SendFullState) {
            let state = new HashedMap<AgentId, Hash>();
            state.fromArrays(gossip.state.hashes, gossip.state.entries);
            this.receiveFullState(source, new Map(state.entries()));
        }

        if (gossip.type === GossipType.SendStateObject) {
            let state = HashedObject.fromLiteral(gossip.state);
            this.receiveStateObject(source, gossip.agentId, state, gossip.timestamp);
        }

        if (gossip.type === GossipType.RequestFullState) {
            this.sendFullState(source);
        }

        if (gossip.type === GossipType.RequestStateObject) {
            this.controlLog.trace('Recevied state request for ' + gossip.agentId);
            if (this.localStateObjects.get(gossip.agentId)) {
                this.sendStateObject(source, gossip.agentId, SendingReason.Request);    
            } else {
                this.controlLog.debug('Recevied state request for ' + gossip.agentId + ', but no state was found: not sending')
            }
            
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

    // message handling

    private async receiveFullState(sender: Endpoint, state: PeerState) {

        for(const [agentId, hash] of state.entries()) {

            if (this.trackedAgentIds.has(agentId)) {
                const agent = this.getLocalStateAgent(agentId);

                if (agent !== undefined) {
    
                    //const currentState = this.localState.get(agentId);
    
                    //if (currentState !== hash) {
                        
                        let stateObj = this.getStateFromPreviousCache(agentId, hash);

                        if (stateObj === undefined) {
                            
                            stateObj = this.lookupStateObject(agentId, hash);                            
    
                            // I _think_ it's better to not gossip in this case.
                        } else {
                            StateGossipAgent.controlLog.trace('Not gossiping to ' + agentId + ' because ' + hash + ' is in the prev state cache');
                        }

                        try {
                                
                            if (stateObj === undefined) {
                                this.requestStateObject(sender, agentId);
                            } else {
                                this.receiveStateObject(sender, agentId, stateObj, Date.now());
                            }
                            
                        } catch (e) {
                            StateGossipAgent.controlLog.warning('Error while processing received state for ' + agentId, e);
                        }

                    //}
                }
            } else {
                StateGossipAgent.controlLog.debug('Received state for agentId ' + agentId + ', but it is not being tracked')
            }

        }

    }

    private async receiveStateObject(sender: Endpoint, agentId: AgentId, stateObj: HashedObject, _timestamp: number) {

        const stateHash = stateObj.hash();

        if (stateHash !== this.getRemoteState(sender, agentId)) {
            if (await stateObj.validate(new Map())) {
            

                this.setRemoteState(sender, agentId, stateHash, stateObj);
                this.cachePreviousState(agentId, stateHash, stateObj);
                
                let receivedOldState = false;

                try {
                    receivedOldState = ! (await this.notifyAgentOfStateArrival(sender, agentId, stateHash, stateObj));
                } catch (e) {
                    // maybe cache erroneous states so we don't process them over and over?
                    StateGossipAgent.controlLog.warning('Received erroneous state from ' + sender + ' for ' + agentId, e);
                }
    
                StateGossipAgent.controlLog.trace('Received state for ' + agentId + ': (' + stateHash + '-' + (receivedOldState? 'old' : 'new') + ')');
    
                if (receivedOldState && this.localState.get(agentId) !== stateHash && this.localStateObjects.get(agentId) !== undefined) {
                    this.peerMessageLog.trace('Received old state for ' + agentId + ' from ' + sender + ', sending our own state over there.');
                    this.sendStateObject(sender, agentId);
                }
            } else {
                this.peerMessageLog.trace('Received invalid state for ' + agentId + ' from ' + sender + ', ignoring.');
            }
        }

        

    }

    private async notifyAgentOfStateArrival(sender: Endpoint, agentId: AgentId, stateHash: Hash, state: HashedObject) : Promise<boolean> {

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
            throw new Error('Cannot find receiving agent for id: ' + agentId);
        }

    }


    // message sending

    private sendFullState(ep: Endpoint) {

        let fullStateMessage: SendFullState = { 
            type  : GossipType.SendFullState,
            state : new HashedMap<AgentId, Hash>(this.localState.entries()).toArrays()
        };

        this.sendMessageToPeer(ep, this.getAgentId(), fullStateMessage);
    }

    private sendStateObject(peerEndpoint: Endpoint, agentId: AgentId, why: SendingReason = SendingReason.Gossip) {
        
        const state = this.localStateObjects.get(agentId);

        if (state !== undefined) {
            const timestamp = Date.now();
            const stateLiteral = state.toLiteral();

            // const lastSentKey = peerEndpoint + '_' + agentId.replaceAll('_', '__'); // no replaceAll for crying out loud
            const lastSentKey = peerEndpoint + '_' + agentId.replace(new RegExp('_', 'g'), '__');

            const lastSent = this.sentStateCache.get(lastSentKey);

            const requested = why === SendingReason.Request;

            const isRepeat           = lastSent !== undefined && lastSent.stateHash === stateLiteral.hash;
            const elapsedSendingFreq = lastSent !== undefined && timestamp > lastSent.timestamp + this.params.maxStateSendingFreq * 1000;
            const shouldSendRepeat   = lastSent !== undefined && lastSent.repeats < this.params.maxStateSendingRepeats;

            if (requested || !isRepeat || elapsedSendingFreq || shouldSendRepeat ) {
            
                let stateUpdateMessage : SendStateObject = {
                    type      : GossipType.SendStateObject,
                    agentId   : agentId,
                    state     : stateLiteral,
                    timestamp : timestamp
                };
        
                this.peerMessageLog.debug('Sending state for ' + agentId + ' from ' + this.peerGroupAgent.getLocalPeer().endpoint + ' to ' + peerEndpoint);
                let sent = this.sendMessageToPeer(peerEndpoint, this.getAgentId(), stateUpdateMessage);
        
                if (sent) {

                    const newRepeats   = isRepeat? (lastSent?.repeats || 0) + 1 : 1;
                    const newTimestamp = isRepeat? lastSent?.timestamp || timestamp : timestamp; 

                    this.sentStateCache.set(lastSentKey, {timestamp: newTimestamp, stateHash: stateLiteral.hash, repeats: newRepeats});
                } else {
                    this.controlLog.debug('Sending state failed!');
                }
            } else {
                this.controlLog.warning('not gossiping: repeats = ' + lastSent?.repeats + ' for agent ' + agentId);
            }
            
        } else {
            this.controlLog.warning('Attempting to send our own state to ' + peerEndpoint + ' for agent ' + agentId + ', but no state object found');
        }

    }

    private requestStateObject(peerEndpoint: Endpoint, agentId: AgentId) {

        let requestStateUpdateMessage : RequestStateObject = {
            type    : GossipType.RequestStateObject,
            agentId : agentId            
        };

        this.peerMessageLog.debug('Sending state update request for ' + agentId + ' from ' + this.peerGroupAgent.getLocalPeer().endpoint + ' to ' + peerEndpoint);
        let result = this.sendMessageToPeer(peerEndpoint, this.getAgentId(), requestStateUpdateMessage);

        if (!result) {
            this.controlLog.debug('Sending state request failed!');
        }

    }

    // for other agents

    getAllRemoteStateForAgent(agentId: AgentId): {[key: Endpoint]: Hash} {

        let state: {[key: Endpoint]: Hash} = {};


        for (const [endpoint, peerState] of this.remoteState.entries()) {

            if (this.peerGroupAgent.isPeer(endpoint)) {   // <--   this needs to work even if we still haven't received the
                const stateHash = peerState.get(agentId); //       event telling us that endpoint is offline, so call directly
            
                if (stateHash !== undefined) {
                    state[endpoint] = stateHash;
                }
            }
        }

        return state;
    }

    getLocalStateForAgent(agentId: AgentId): Hash|undefined {
        return this.localState.get(agentId);
    }

}

export { StateGossipAgent, AgentStateUpdateEvent, GossipEventTypes };