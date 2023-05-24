import { Hash, HashedObject, HashReference } from 'data/model';
import { ForkableObject, LinearOp, MergeOp, ForkChoiceRule } from 'data/model';
import { Identity, MultiMap } from 'index';

type CounterOp = CounterSettlementOp|CounterChangeOp;

class CounterSettlementOp extends MergeOp {

    static className = 'hhs-test/CounterSettlementOp';

    settledChangeAmount?: bigint;
    settledValue?: bigint;

    height?: bigint;

    constructor(targetCounter?: PositiveCounter, settledOps?: IterableIterator<CounterOp>, references?: Map<Hash, HashedObject>) {
        super(targetCounter, settledOps);

        if (targetCounter !== undefined) {
            if (!(targetCounter instanceof PositiveCounter)) {
                throw new Error('Trying to create a CounterSettlementOp, but the target is not an instance of PositiveCounter.');
            }

            if (settledOps === undefined) {
                throw new Error('Trying to create a CounterSettlementOp, but the settledOps parameter is missing.');
            }

            let changeAmount = BigInt(0);

            let maxHeight = BigInt(0);

            for (const opRef of this.allMergeContents?.values()!) {

                const op = this.getForkableOp(opRef.hash, references);

                if (op === undefined) {
                    throw new Error('Trying to create a CounterSettlementOp that references a merged op that has not been applied to the supplied PositiveCounter target.');
                }

                if (!targetCounter.equalsUsingLastHash(op.getTargetObject())) {
                    throw new Error('Trying to create a CounterSettlementOp that references a merged op that does not have the supplied PositiveCounter as a target.');
                }

                if (op instanceof CounterChangeOp) {
                    changeAmount += op.changeAmount as bigint;
                }

                if ((op instanceof CounterChangeOp) || (op instanceof CounterSettlementOp)) {
                    if (op.height as bigint > maxHeight) {
                        maxHeight = op.height as bigint;
                    }
                }

                this.height = maxHeight + BigInt(1);
            }

            this.settledChangeAmount = changeAmount;
            this.settledValue = changeAmount;

            if (this.forkPointOp !== undefined) {
                const op = this.getForkableOp(this.forkPointOp.hash, references);

                if (op === undefined) {
                    throw new Error('Trying to create a CounterSettlementOp that references a fork point op that has not been applied to the supplied PositiveCounter target.');
                }

                if (!targetCounter.equalsUsingLastHash(op.getTargetObject())) {
                    throw new Error('Trying to create a CounterSettlementOp that references a merged op that does not have the supplied PositiveCounter as a target.');
                }

                if (op instanceof CounterSettlementOp) {
                    this.settledValue += (op.settledValue as bigint);
                } else if (op instanceof CounterChangeOp) {
                    this.settledValue += (op.newValue as bigint);
                } else {
                    throw new Error('Trying to create a CounterSettlementOp that reference a merged op that is of the wrong class.');
                }
            }

            if (this.settledValue < BigInt(0)) {
                throw new Error('A PositiveCounter cannot settle on a negative value.');
            }
        }
    }

    getClassName(): string {
        return CounterSettlementOp.className;
    }

    init(): void {
        
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {

        const settledOps = new Set<CounterOp>();

        for (const opRef of this.mergedOps?.values() as IterableIterator<HashReference<CounterOp>>) {
            const op = this.getForkableOp(opRef.hash);

            if (op === undefined) {
                return false;
            }

            settledOps.add(op as CounterOp);
        }
        
        const clone = new CounterSettlementOp(this.getTargetObject() as PositiveCounter, settledOps.values(), references);

        if (this.hasAuthor()) {
            clone.setAuthor(this.getAuthor() as Identity);
        }
        
        if (this.hasId()) {
            clone.setId(this.getId() as string);
        }

        if (!this.equals(clone)) {
            return false;
        }

        return true;
    }

    getValue() {
        return this.settledValue as bigint;
    }
}

class CounterChangeOp extends LinearOp {
    
    static className = 'hhs-test/CounterChangeOp';

    changeAmount?: bigint;
    newValue?: bigint;

    height?: bigint;

    constructor(targetCounter?: PositiveCounter, changeAmount?: bigint, prevCounterOp?: CounterOp) {
        super(targetCounter, prevCounterOp);

        if (targetCounter !== undefined) {

            if (!(targetCounter instanceof PositiveCounter)) {
                throw new Error('Attempting to create a new CounterChangeOp, but the targe tis not a PositiveCounter.');
            }

            if (typeof(changeAmount) !== 'bigint') {
                throw new Error('The changeAmount in a new CounterChageOp must be a bigint');
            }

            this.setRandomId();

            this.changeAmount = changeAmount;
            this.newValue     = changeAmount;
    
            if (prevCounterOp instanceof CounterChangeOp) {
                this.newValue = this.newValue + (prevCounterOp.newValue as bigint);
            } else if (prevCounterOp instanceof CounterSettlementOp) {
                this.newValue = this.newValue + (prevCounterOp.settledValue as bigint);
            } else {
                throw new Error('Attempting to create a CounterChangeOp, but the prevCounterOp is not a CounterOp.');
            }
    
            if (prevCounterOp === undefined) {
                this.height = BigInt(0);
            } else {
                this.height = (prevCounterOp.height as bigint) + BigInt(1);
            }

            if (this.newValue as bigint < BigInt(0)) {
                throw new Error('Cannot create value change op for ' + this.getTargetObject().getLastHash() + ', it would make the value go negative.');
            }
        }

    }
    
    getClassName(): string {
        return CounterChangeOp.className;
    }

    init(): void {

    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {

        const prev = this.prevForkableOp === undefined? undefined : references.get(this.prevForkableOp.hash) as CounterOp;

        if (this.prevForkableOp !== undefined && prev === undefined) {
            return false;
        }

        const clone = new CounterChangeOp(this.getTargetObject() as PositiveCounter, this.changeAmount, prev);

        const id = this.getId();

        if (typeof(id) !== 'string') {
            return false;
        }

        clone.setId(id);

        if (this.hasAuthor()) {
            clone.setAuthor(this.getAuthor() as Identity);
        }

        if (!this.equals(clone)) {
            return false;
        }

        return true;
    }

    getValue() {
        return this.newValue as bigint;
    }
}

class SettlementRule implements ForkChoiceRule<CounterChangeOp, CounterSettlementOp> {
    
    shouldReplaceCurrent(newLastOp: CounterSettlementOp, currentLastOp: CounterSettlementOp): boolean {
        
        return (newLastOp.height as bigint) > (currentLastOp.height as bigint) ||
               ((newLastOp.height as bigint) === (currentLastOp.height as bigint) && newLastOp.getLastHash().localeCompare(currentLastOp.getLastHash()) > 0 )      

    }
}

class PositiveCounter extends ForkableObject<CounterChangeOp, CounterSettlementOp> {

    static className = 'hhs-test/PositiveCounter';
    static opClasses = [CounterSettlementOp.className, CounterChangeOp.className];

    _unsettledInitialAmount: bigint;
    _unsettledAmountAfterSettlement: Map<Hash, bigint>;
    _prevSettlementOpForChangeOp: Map<Hash, Hash>;

    _allChangeOps: Map<Hash, CounterChangeOp>;

    constructor() {
        super(PositiveCounter.opClasses, 
              { 
                forkChoiceRule: new SettlementRule()
              }
            );

        this.setRandomId();

        this._unsettledInitialAmount = BigInt(0);

        this._unsettledAmountAfterSettlement = new Map();
        this._prevSettlementOpForChangeOp = new Map();

        this._allChangeOps = new Map();
    }

    getValue() {
        if (this._currentForkTerminalOp === undefined) {
            return BigInt(0);
        } else {
            if (this._currentForkTerminalOp instanceof CounterSettlementOp) {
                return this._currentForkTerminalOp.settledValue as bigint;
            } else if (this._currentForkTerminalOp instanceof CounterChangeOp) {
                return this._currentForkTerminalOp.newValue as bigint;
            } else {
                throw new Error('The current fork temrinal op in PositiveCounter ' + this.getLastHash() + ' does is not an instance of one of the expected classes.');
            }
        }
    }

    async changeValueBy(amount: bigint) {
        const op = new CounterChangeOp(this, amount, this._currentForkTerminalOp);

        return this.apply(op, true);
    }

    isSettled() {
        return this._terminalEligibleOps.size <= 1;
    }

    getUnsettledValue() {

        if (this.isSettled()) {
            return this.getValue();
        } else {
            const fork = MergeOp.findForkPoint(this, this.getTerminalEligibleOps().values());

            let settledValue = BigInt(0);

            if (fork.forkPointOp !== undefined) {
                settledValue = settledValue + (fork.forkPointOp as CounterOp).getValue();
            }

            for (const op of fork.mergeConentOps.values()) {
                settledValue = settledValue + (op as CounterOp).getValue();
            }

            return settledValue;
        }        
    }

    canSettle() {
        return this.isSettled() || this.getUnsettledValue() >= BigInt(0);
    }

    async settle() {
        if (!this.isSettled()) {
            const op = new CounterSettlementOp(this, this.getTerminalEligibleOps().values());
            return this.apply(op, true);
        } else {
            return false;
        }
    }

    getMutableContents(): MultiMap<string, HashedObject> {
        return new MultiMap();
    }

    getMutableContentByHash(): Set<HashedObject> {
        return new Set();
    }

    getClassName(): string {
        return PositiveCounter.className;
    }

    init(): void {
        
    }

    async validate(_references: Map<string, HashedObject>): Promise<boolean> {
        return this.hasId();
    }
}

export { PositiveCounter, CounterChangeOp, CounterSettlementOp };