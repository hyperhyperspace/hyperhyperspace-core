import '@hyper-hyper-space/node-env';

import { Hashing, HashedObject, MutableObject, MutationOp } from 'data/model';

import { BeaconValueOp } from './BeaconValueOp';

import { Worker, parentPort } from 'worker_threads';
import { Logger, LogLevel } from 'util/logging';

const createVdf = require('@subspace/vdf').default;
(global as any).document = { }; // yikes!

class Beacon extends MutableObject {

    static log = new Logger(Beacon.name, LogLevel.DEBUG)
    

    static className = 'hhs/v0/examples/Beacon';
    static opClasses = [BeaconValueOp.className];

    steps?: number;

    _lastOp?: BeaconValueOp;
    _values: string[];

    _computation?: Worker;
    _autoCompute: boolean;

    static computeVdf(): void {

        parentPort?.on('message', async (q: {challenge: string, steps: number}) => {

            const vdfInstance = await createVdf();
            const result = vdfInstance.generate(q.steps, Buffer.from(q.challenge, 'hex'), 2048, true);

            parentPort?.postMessage(
                { 
                    challenge: q.challenge,
                    steps: q.steps,
                    result: Buffer.from(result).toString('hex')
                }
            );
        });
        

    }

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
        this.stopCompute();
    }

    race() {
        if (this._computation === undefined) {

            Beacon.log.debug(() => 'Racing for challenge (' + this.steps + ' steps): "' + this.currentChallenge() + '".');

            this._computation = new Worker('./dist-examples/examples/randomness-beacon/model/worker.js');

            this._computation.postMessage({steps: this.steps, challenge: this.currentChallenge()});

            this._computation.on('message', async (msg: {challenge: string, result: string}) => {
                
                Beacon.log.debug(() => 'Solved challenge "' + msg.challenge + '" with: "' + msg.result + '".');

                this.stopRace();

                if (msg.challenge === this.currentChallenge()) {
                    let op = new BeaconValueOp(this, this.currentSeq(), msg.result);

                    if (this._lastOp !== undefined) {
                        op.setPrevOps(new Set([this._lastOp.createReference()]).values());
                    }

                    await this.applyNewOp(op);
                    if (this._autoCompute) {
                        this.race();
                    }
                }
            });
        }
    }

    stopRace() {
        if (this._computation !== undefined) {
            this._computation.terminate();
            this._computation = undefined;
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

                if (op.prevOps?.size() === 0) {

                    if (this._lastOp !== undefined) {
                        throw new Error('Initial BeaconValueOp received, but there are already other ops in this beacon.');
                    }
    
                } else {
                    if (this._lastOp === undefined) {
                        throw new Error('Non-initial BeaconValueOp received, but there are no values in this beacon.');
                    }
    
                    if (!this._lastOp.equals(op.prevOps?.values().next().value)) {
                        throw new Error('Received BeaconValueOp does not point to last known beacon value.');
                    }
                }

                this._lastOp = op;

                this._values.push(Hashing.toHex(op.hash()));

                this.stopRace();

                if (this._autoCompute) {
                    this.race();
                }
            
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

}

export { Beacon };