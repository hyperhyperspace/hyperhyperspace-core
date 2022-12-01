import { Hash, HashedObject, MutableObject } from 'data/model';
import { Agent } from 'mesh/service';
import { AgentId } from 'mesh/service/Agent';
import { AgentPod, AgentEvent, AgentPodEventType, AgentSetChangeEvent, AgentSetChange } from 'mesh/service/AgentPod';
import { Event, EventRelay, Observer } from 'util/events';
import { MultiMap } from 'util/multimap';
import { Endpoint } from '../network';
import { StateSyncAgent } from './StateSyncAgent';

/*
 * Sync Observers
 * ==============
 * 
 * All sync agents have an EventRelay that sends an event whenver the sync state changes
 * (new mutation ops are discovered and need to be fetched, etc.). Users of the mesh can
 * observe the sync state by using the methods addSyncObserver / removeSyncObserver.
 * 
 * Note: we want that if an observer is added, and the object stops being synchronized
 * (and the sync agent is stopped), but later sync is resumed, this works transparently
 * for any observers that have been added. This is accomplished by having the observers
 * at the mesh level, and chaining an observer from the sync agent when one becomes
 * available. The sequence then looks like this:
 * 
 * - syncObjectWithPeerGroup() is called
 * - addSyncObserver() is called -> ... to be continued
 */

type SyncState = { remoteStateHashes: {[key: Endpoint]: Hash}, localStateHash?: Hash, allPeersInSync: boolean, opsToFetch: number, synchronizing: boolean };

type SyncObserver = Observer<HashedObject, SyncState>;
type SyncEvent    = Event<HashedObject, SyncState>;



enum SyncObserverEventTypes {
    SyncStateUpdate = 'sync-state-update'
};

type SyncStateUpdateEvent = { emitter: HashedObject, action: SyncObserverEventTypes.SyncStateUpdate, data: SyncState };

type PeerGroupId = string;

class SyncObserverAgent implements Agent {

    static AgentId = 'sync-observer-agent';

    pod?: AgentPod;

    observers : MultiMap<AgentId, SyncObserver>;
    relays    : Map<AgentId, [EventRelay<HashedObject>, SyncObserver, MutableObject]>;

    constructor() {
        this.observers = new MultiMap();
        this.relays = new Map();
    }

    getAgentId(): string {
        return SyncObserverAgent.AgentId;
    }

    ready(pod: AgentPod): void {
        this.pod = pod;
    }

    addSyncObserver(obs: SyncObserver, mut: MutableObject, peerGroupId: PeerGroupId) {

        if (this.pod === undefined) {
            throw new Error('Trying to add a sync observer, but the SyncObserverAgent is not ready.');
        }

        const syncAgentId = mut.getSyncAgentId(peerGroupId);
        const syncAgent   = this.pod.getAgent(syncAgentId) as StateSyncAgent|undefined;

        let tuple = this.relays.get(syncAgentId);
        
        if (tuple === undefined) {

            const relay = new EventRelay<HashedObject>(mut);
            const syncAgentObs = (ev: SyncEvent) => {
                relay.emit(ev);
            }

            tuple = [relay, syncAgentObs, mut];
    
            this.relays.set(syncAgentId, tuple);
    
            
            if (syncAgent !== undefined) {
                syncAgent.getSyncEventSource().addObserver(syncAgentObs);
            }
        }

        tuple[0].addObserver(obs);

        if (syncAgent !== undefined) {
            obs({
                emitter: mut,
                action: SyncObserverEventTypes.SyncStateUpdate,
                data: syncAgent.getSyncState()
            });
        } else {
            obs({
                emitter: mut,
                action: SyncObserverEventTypes.SyncStateUpdate,
                data: {allPeersInSync: false, opsToFetch: 0, remoteStateHashes: {}, synchronizing: false}
            });
        }
    }

    removeSyncObserver(obs: SyncObserver, mut: MutableObject, peerGroupId: PeerGroupId) {

        if (this.pod === undefined) {
            throw new Error('Trying to remove a sync observer, but the SyncObserverAgent is not ready.');
        }

        const syncAgentId = mut.getSyncAgentId(peerGroupId);
        const tuple        = this.relays.get(syncAgentId);

        if (tuple !== undefined) {
            const [relay, syncAgentObs, _mut] = tuple;
            relay.removeObserver(obs);

            if (relay.observers.size === 0) {

                const syncAgent = this.pod.getAgent(syncAgentId) as StateSyncAgent|undefined;

                if (syncAgent !== undefined) {
                    syncAgent.getSyncEventSource().removeObserver(syncAgentObs);
                }
                
                this.relays.delete(syncAgentId);
            }
        }
    }

    receiveLocalEvent(ev: AgentEvent): void {

        if (ev.type === AgentPodEventType.AgentSetChange) {
            const agentEv = ev as AgentSetChangeEvent;

            const syncAgentId = agentEv.content.agentId;
            const tuple = this.relays.get(syncAgentId);

            if (tuple !== undefined) {
                const [relay, syncAgentObserver, mut] = tuple;
                if (agentEv.content.change === AgentSetChange.Addition) {

                    const syncAgent = this.pod?.getAgent(syncAgentId) as StateSyncAgent;
                    syncAgent.getSyncEventSource().addObserver(syncAgentObserver);

                    relay.emit({
                        emitter: mut,
                        action: SyncObserverEventTypes.SyncStateUpdate,
                        data: syncAgent.getSyncState()
                    });

                } else if (agentEv.content.change === AgentSetChange.Removal) {

                    console.log('SENDING LAST EV FOR ' + mut.getLastHash());

                    const syncAgent = this.pod?.getAgent(syncAgentId) as StateSyncAgent|undefined;
                    syncAgent?.getSyncEventSource().removeObserver(syncAgentObserver); // I think this will have no effect
                    relay.emit({
                        emitter: mut,
                        action: SyncObserverEventTypes.SyncStateUpdate,
                        data: {allPeersInSync: false, opsToFetch: 0, remoteStateHashes: {}, synchronizing: false}
                    });

                }
            }
        }
    }

    shutdown(): void {
        
    }
}

export { SyncObserverAgent, SyncObserverEventTypes };
export type { SyncState, SyncObserver, SyncEvent, SyncStateUpdateEvent };