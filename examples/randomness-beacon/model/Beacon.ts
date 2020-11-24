import '@hyper-hyper-space/node-env';

import { Hashing, HashReference, HashedObject, MutableObject, MutationOp } from 'data/model';

import { Identity } from 'data/identity';


import { SpaceEntryPoint } from 'spaces/SpaceEntryPoint';

import { Mesh } from 'mesh/service';
import { LinkupManager } from 'net/linkup';
import { ObjectDiscoveryPeerSource } from 'mesh/agents/peer';
import { PeerGroupInfo } from 'mesh/service';
import { IdentityPeer } from 'mesh/agents/peer';

import { BeaconValueOp } from './BeaconValueOp';

import { Worker } from 'worker_threads';
import { Logger, LogLevel } from 'util/logging';

class Beacon extends MutableObject implements SpaceEntryPoint {

    static log = new Logger(Beacon.name, LogLevel.DEBUG)
    

    static className = 'hhs/v0/examples/Beacon';
    static opClasses = [BeaconValueOp.className];

    steps?: number;

    _lastOp?: BeaconValueOp;
    _values: string[];

    _computation?: Worker;
    _computationTermination?: Promise<Number>;
    _autoCompute: boolean;

    _mesh?: Mesh;
    _peerGroup?: PeerGroupInfo;

    constructor(seed?: string, steps?: number) {
        super(Beacon.opClasses);

        if (seed !== undefined && steps !== undefined) {
            this.setId(seed);
            this.steps = steps;
        }
        
        this._values = [];
        this._autoCompute = false;
    }

    startCompute() {
        this._autoCompute = true;
        this.race();
    }

    stopCompute() {
        this._autoCompute = false;
        this.stopRace();
    }

    race() {
        if (this._computation === undefined) {

            Beacon.log.debug(() => 'Racing for challenge (' + this.steps + ' steps): "' + this.currentChallenge() + '".');

            this._computation = new Worker('./dist-examples/examples/randomness-beacon/model/worker.js');
            this._computation.on('error', (err: Error) => { console.log('ERR');console.log(err)});
            this._computation.on('message', async (msg: {challenge: string, result: string}) => {
                
                Beacon.log.debug(() => 'Solved challenge "' + msg.challenge + '" with: "' + msg.result + '".');

                if (msg.challenge === this.currentChallenge()) {
                    let op = new BeaconValueOp(this, this.currentSeq(), msg.result);

                    if (this._lastOp !== undefined) {
                        op.setPrevOps(new Set([this._lastOp.createReference()]).values());
                    } else {
                        op.setPrevOps(new Set<HashReference<BeaconValueOp>>().values());
                    }

                    await this.applyNewOp(op);
                    await this.getStore().save(this);
                    
                } else {
                    Beacon.log.debug('Mismatched challenge - could be normal.');
                }
            });
            this._computation.postMessage({steps: this.steps, challenge: this.currentChallenge()});
            
        } else {
            Beacon.log.debug('Race was called but a computation is running.');
        }
    }

    stopRace() {
        Beacon.log.debug('Going to stop current VDF computation.');
        if (this._computation !== undefined) {
            if (this._computationTermination === undefined) {
                this._computationTermination = this._computation.terminate().then(
                    (ret: number) => {
                        Beacon.log.trace('Stopped VDF computation');
                        this._computation = undefined;
                        this._computationTermination = undefined;
                        return ret;
                    }
                );
    
            }
        }
    }

    private currentChallenge(): string {
        if (this._lastOp === undefined) {
            return this.getId() as string;
        } else {
            return Hashing.toHex(this._lastOp.hash());
        }
    }

    private currentSeq() {
        if (this._lastOp === undefined) {
            return 0;
        } else {
            return (this._lastOp.seq as number) + 1;
        }
    }


    async mutate(op: MutationOp, isNew: boolean): Promise<void> {
       
        isNew;

        if (op instanceof BeaconValueOp) {

            if (this._lastOp === undefined ||
                !this._lastOp.equals(op)) {

                if (op.prevOps === undefined) {
                    throw new Error('BeaconValueOp must have a defined prevOps set (even if it is empty).');
                }


                if (op.prevOps.size() === 0) {

                    if (this._lastOp !== undefined) {
                        throw new Error('Initial BeaconValueOp received, but there are already other ops in this beacon.');
                    }
    
                } else {
                    if (this._lastOp === undefined) {
                        throw new Error('Non-initial BeaconValueOp received, but there are no values in this beacon.');
                    }
    
                    if (!this._lastOp.hash() === op.prevOps.values().next().value.hash) {
                        throw new Error('Received BeaconValueOp does not point to last known beacon value.');
                    }
                }

                this._lastOp = op;

                this._values.push(Hashing.toHex(op.hash()));

                if (this._autoCompute) {
                    if (this._computation === undefined) {
                        this.race();
                    } else {
                        this.stopRace();
                        this._computationTermination?.then(() => { this.race(); });
                    }
                }

                Beacon.log.debug('Challenge now is "' + this.currentChallenge() + '" for beacon position ' + this.currentSeq() + '.');
            
            }

            
        } 

    }

    getClassName(): string {
        return Beacon.className;
    }

    init(): void {
        
    }

    validate(references: Map<string, HashedObject>): boolean {
       references;

       return this.steps !== undefined && this.getId() !== undefined;
    }

    async startSync(): Promise<void> {

        let resources = this.getResources();

        if (resources === undefined) {
            throw new Error('Cannot start sync: resources not configured.');
        }

        this._mesh = resources.mesh;

        if (this._mesh === undefined) {
            throw new Error('Cannot start sync: mesh is missing from configured resources.');
        }

        let linkupServers = resources.config.linkupServers === undefined?
                            [LinkupManager.defaultLinkupServer] : resources.config.linkupServer as string[];


        let localIdentity = resources.config.id as Identity;

        const localPeer     = await new IdentityPeer(linkupServers[0] as string, localIdentity.hash(), localIdentity).asPeer();

        this._mesh.startObjectBroadcast(this, linkupServers, [localPeer.endpoint]);

        let peerSource = new ObjectDiscoveryPeerSource(this._mesh, this, linkupServers, localPeer.endpoint, IdentityPeer.getEndpointParser(resources.store));

        this._peerGroup = {
            id: 'sync-for-' + this.hash(),
            localPeer: localPeer,
            peerSource: peerSource
        }

        this._mesh.joinPeerGroup(this._peerGroup);
        this._mesh.syncObjectWithPeerGroup(this._peerGroup.id, this);

        this.loadAndWatchForChanges();
    }
    
    async stopSync(): Promise<void> {

        const peerGroupId = this._peerGroup?.id as string;
        
        this._mesh?.stopSyncObjectWithPeerGroup(peerGroupId, this.hash());
        this._mesh?.stopObjectBroadcast(this.hash());
        this._mesh?.leavePeerGroup(peerGroupId);

        this._mesh = undefined;
        this._peerGroup = undefined;
    }

}

HashedObject.registerClass(Beacon.className, Beacon);

export { Beacon };