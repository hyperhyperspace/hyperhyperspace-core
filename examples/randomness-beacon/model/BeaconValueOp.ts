
import { Hashing, Hash, HashedObject, MutationOp } from 'data/model';

import { Beacon } from './Beacon';

const createVdf = require('@subspace/vdf');


class BeaconValueOp extends MutationOp {

    static className = 'hhs/v0/examples/BeaconValueOp';

    static vdfInit = async () => {
        BeaconValueOp.vdfVerifier = await createVdf();
    };
    static vdfVerifier: any;


    seq?: number;
    vdfResult?: string;

    constructor(target?: Beacon, seq?: number, vdfResult?: string) {
        super(target);

        if (seq !== undefined && vdfResult !== undefined) {
            this.seq = seq;
            this.vdfResult = vdfResult;
        }
    }

    getClassName(): string {
        return BeaconValueOp.className;
    }

    init(): void {
        
    }

    validate(references: Map<Hash, HashedObject>): boolean {

        if (this.seq === undefined || this.vdfResult === undefined) {
            return false;
        }

        if (this.seq < 0) {
            return false;
        }

        if (!super.validate(references)) {
            return false;
        }

        if (! (this.getTarget() instanceof Beacon)) {
            return false;
        }

        if (this.getAuthor() !== undefined) {
            return false;
        }

        if (this.prevOps === undefined) {
            return false;
        }

        let challenge: string;

        if (this.prevOps.size() === 0) {
            if (this.seq !== 0) {
                return false;
            }

            challenge = this.getTarget().getId() as string;
        } else {
            if (this.prevOps.size() !== 1) {
                return false;
            }

            let prev = this.prevOps.values().next().value;

            if (!(prev instanceof BeaconValueOp)) {
                return false;
            }

            if (prev.getTarget().equals(this.getTarget())) {
                return false;
            }

            if ((prev.seq as number) + 1 !== this.seq) {
                return false;
            }

            challenge = Hashing.toHex(prev.hash());
        }

        const steps = (this.getTarget() as Beacon).steps as number;

        if (!BeaconValueOp.vdfVerifier.verify(steps, challenge, this.vdfResult, 2048, true)) {
            return false;
        }

        return true;

    }

}

export { BeaconValueOp };