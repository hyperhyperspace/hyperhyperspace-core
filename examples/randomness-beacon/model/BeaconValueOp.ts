
import { Hashing, Hash, HashedObject, MutationOp } from 'data/model';
import { Logger, LogLevel } from 'util/logging';

import { Beacon } from './Beacon';

const createVdf = require('@subspace/vdf').default;
(global as any).document = { }; // yikes!

class BeaconValueOp extends MutationOp {

    static log = new Logger(BeaconValueOp.name, LogLevel.TRACE)

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
            BeaconValueOp.log.trace('Object is incomplete.');
            return false;
        }

        if (this.seq < 0) {
            BeaconValueOp.log.trace('Sequence number is negative.');
            return false;
        }

        if (!super.validate(references)) {
            BeaconValueOp.log.trace('Generic op validation failed.');
            return false;
        }

        if (! (this.getTarget() instanceof Beacon)) {
            BeaconValueOp.log.trace('Target is nt a Beacon instance.');
            return false;
        }

        if (this.getAuthor() !== undefined) {
            BeaconValueOp.log.trace('Author is not undefined as it should be.');
            return false;
        }

        if (this.prevOps === undefined) {
            BeaconValueOp.log.trace('PrevOps is missing (it should be empty or a singleton - not missing).');
            return false;
        }

        let challenge: string;

        if (this.prevOps.size() === 0) {
            if (this.seq !== 0) {
                BeaconValueOp.log.trace('PrevOps is empty and sequence is not 0.');
                return false;
            }

            challenge = this.getTarget().getId() as string;
        } else {
            if (this.prevOps.size() !== 1) {
                BeaconValueOp.log.trace('PrevOps size is not 0 or 1.');
                return false;
            }

            let prev = references.get(this.prevOps.values().next().value.hash);

            if (!(prev instanceof BeaconValueOp)) {
                BeaconValueOp.log.trace('prevOP is not an instance of BeaconValueOp.');
                return false;
            }

            if (!prev.getTarget().equals(this.getTarget())) {
                BeaconValueOp.log.trace('The prevOp and this op targets differ.');
                return false;
            }

            if ((prev.seq as number) + 1 !== this.seq) {
                BeaconValueOp.log.trace('Sequence number is not prevOps + 1.');
                return false;
            }

            challenge = Hashing.toHex(prev.hash());
        }

        const steps = (this.getTarget() as Beacon).steps as number;


        //TODO: make sure there is no upper/lowercase ambiguity in the vdfResult!

        const challengeBuffer = Buffer.from(challenge, 'hex');
        const resultBuffer = Buffer.from(this.vdfResult, 'hex');

        if (!BeaconValueOp.vdfVerifier.verify(steps, challengeBuffer, resultBuffer, 2048, false)) {
            BeaconValueOp.log.trace('VDF verification failed.');
            return false;
        }

        return true;

    }

}

HashedObject.registerClass(BeaconValueOp.className, BeaconValueOp);

export { BeaconValueOp };