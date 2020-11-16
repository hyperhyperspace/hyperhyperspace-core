import { Hashing, HashedObject, MutableObject, MutationOp } from 'data/model';

import { BeaconValueOp } from './BeaconValueOp';

class Beacon extends MutableObject {

    static className = 'hhs/v0/examples/Beacon';
    static opClasses = [BeaconValueOp.className];

    steps?: number;

    _lastOp?: BeaconValueOp;
    _values: string[];

    constructor(seed?: string, steps?: number) {
        super(Beacon.opClasses);

        if (seed !== undefined && steps !== undefined) {
            this.setId(seed);
            this.steps = steps;
        }
        
        this._values = [];
    }


    async mutate(op: MutationOp, isNew: boolean): Promise<void> {
       
        if (op instanceof BeaconValueOp) {

            if (!isNew && this._lastOp !== undefined &&
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
            
            }

            
        } 

    }

    getClassName(): string {
        throw new Error('Method not implemented.');
    }

    init(): void {
        
    }

    validate(references: Map<string, HashedObject>): boolean {
       references;

       return this.steps !== undefined && this.getId() !== undefined;
    }

}

export { Beacon };