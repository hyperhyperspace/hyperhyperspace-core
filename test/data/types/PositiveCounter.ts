import { ChoiceBasedLinearizationRule, Hash, HashedObject, HashedSet, HashReference, LinearizationOp, LinearObject, MutationOp } from 'data/model';
import { LinearizableOp } from 'data/model/linearizable/LinearizableOp';
import { MultiMap } from 'index';


class CounterSettlementOp extends LinearizationOp {

    static className = 'hhs-test/CounterSettlementOp';

    settledChangeAmount?: bigint;
    settledValue?: bigint;

    getClassName(): string {
        return CounterSettlementOp.className;
    }

    init(): void {
        
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        
        const prevOps = this.getPrevOpsIfPresent();

        let computedSettlement   = BigInt(0);
        let computedChangeAmount = BigInt(0);

        if (this.prevLinearizationOp !== undefined) {

            const prevLinearOp = references.get(this.prevLinearizationOp.hash);

            if (!(prevLinearOp instanceof CounterSettlementOp)) {
                return false;
            }

            computedSettlement = computedSettlement + (prevLinearOp.settledValue as bigint);
        }

        if (prevOps !== undefined) {
            for (const prevOpRef of prevOps) {
                if (prevOpRef.hash !== this.prevLinearizationOp?.hash) {

                    const prevOp = references.get(prevOpRef.hash);

                    if (!(prevOp instanceof CounterChangeOp)) {
                        return false;
                    }

                    computedChangeAmount = computedChangeAmount + (prevOp.changeAmount as bigint);
                }
            }
        }

        computedSettlement = computedSettlement + computedChangeAmount;
        
        if (this.settledValue !== computedSettlement) {
            return false;
        }

        if (this.settledChangeAmount !== computedChangeAmount) {
            return false;
        }

        return true;

    }
}

class CounterChangeOp extends LinearizableOp {
    
    static className = 'hhs-test/CounterChangeOp';

    changeAmount?: bigint;
    newValue?: bigint;

    constructor(changeAmount?: bigint, newValue?: bigint, prevSettlementOp?: CounterSettlementOp) {
        super(prevSettlementOp);

        this.setRandomId();

        this.changeAmount = changeAmount;
        this.newValue     = newValue;
    }
    
    getClassName(): string {
        return CounterChangeOp.className;
    }

    init(): void {

    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {

        const id = this.getId();

        if (typeof(id) !== 'string') {
            return false;
        }

        if (typeof(this.changeAmount) !== 'bigint') {
            return false;
        }

        if (typeof(this.newValue) !== 'bigint') {
            return false;
        }

        const prevOpCount = this.prevOps?.size() || 0;

        if (prevOpCount > 1) {
            return false;
        }

        const prevOpRef = this.getPrevOpsIfPresent()?.next().value;

        let oldValue = BigInt(0);

        if (prevOpRef !== undefined) {
            const prevOp = references.get(prevOpRef.hash);

            if (prevOp instanceof CounterSettlementOp) {
                oldValue = prevOp.settledValue as bigint;
            } else if (prevOp instanceof CounterChangeOp) {
                oldValue = prevOp.newValue as bigint;
            }
        }

        if (oldValue + this.changeAmount !== this.newValue) {
            return false;
        }

        if (this.newValue < BigInt(0)) {
            return false;
        }

        const another = new CounterChangeOp(this.changeAmount, this.newValue);

        another.setId(id);
        if (this.prevOps !== undefined) {
            another.prevOps = new HashedSet<HashReference<MutationOp>>(this.prevOps.values());
        }

        if (!this.equals(another)) {
            return false;
        }

        return true;
    }
}

class SettlementRule extends ChoiceBasedLinearizationRule<CounterSettlementOp> {
    
    shouldUseNewLastOp(newLastOp: CounterSettlementOp, currentLastOp: CounterSettlementOp): boolean {
        
        return (newLastOp.seq as bigint) > (currentLastOp.seq as bigint) ||
               ((newLastOp.seq as bigint) === (currentLastOp.seq as bigint) && newLastOp.getLastHash().localeCompare(currentLastOp.getLastHash()) > 0 )      

    }
}

class PositiveCounter extends LinearObject<CounterSettlementOp> {

    static className = 'hhs-test/PositiveCounter';
    static opClasses = [CounterSettlementOp.className, CounterChangeOp.className];

    _unsettledInitialAmount: bigint;
    _unsettledAmountAfterSettlement: Map<Hash, bigint>;
    _prevSettlementOpForChangeOp: Map<Hash, Hash>;

    _allChangeOps: Map<Hash, CounterChangeOp>;

    constructor() {
        super(PositiveCounter.opClasses, 
              { noDisconnectedOps: true, 
                noLinearizationsAsPrevOps: true, 
                enforceContinuity: true,
                linearizationRule: new SettlementRule()
             });

        this.setRandomId();

        this._unsettledInitialAmount = BigInt(0);

        this._unsettledAmountAfterSettlement = new Map();
        this._prevSettlementOpForChangeOp = new Map();

        this._allChangeOps = new Map();
    }

    async mutate(op: MutationOp, valid: boolean): Promise<boolean> {

        if (op instanceof CounterChangeOp) {

            this._allChangeOps.set(op.getLastHash(), op);

            let prevSettlementOpHash: Hash|undefined;

            const prevOp = op.prevOps === undefined || op.prevOps.size() === 0?
                            undefined :
                            op.getPrevOps().next().value;

            if (prevOp instanceof CounterSettlementOp) {
                prevSettlementOpHash = prevOp.getLastHash();
            } else if (prevOp instanceof CounterChangeOp) {
                prevSettlementOpHash = this._prevSettlementOpForChangeOp.get(prevOp.getLastHash());
            }

            if (prevSettlementOpHash === undefined) {
                this._unsettledInitialAmount = this._unsettledInitialAmount + (op.changeAmount as bigint);
            } else {
                this._prevSettlementOpForChangeOp.set(op.getLastHash(), prevSettlementOpHash);

                let newVal = (this._unsettledAmountAfterSettlement.get(prevSettlementOpHash) || BigInt(0)) +
                             (op.changeAmount as bigint);

                this._unsettledAmountAfterSettlement.set(prevSettlementOpHash, newVal);
            }

            return true;
        } else if (op instanceof CounterSettlementOp) {
            return super.mutate(op, valid);
        }

        return false;
    }

    getValue(): bigint {
        if (this._currentLastLinearOp === undefined) {
            return this._unsettledInitialAmount;
        } else {
            return (this._currentLastLinearOp.settledValue as bigint) + 
                   (this._unsettledAmountAfterSettlement.get(this._currentLastLinearOp.getLastHash()) || BigInt(0))
        }
    }

    getSettledValue(): bigint {
        if (this._currentLastLinearOp === undefined) {
            return BigInt(0);
        } else {
            return (this._currentLastLinearOp.settledValue as bigint) + 
                   (this._unsettledAmountAfterSettlement.get(this._currentLastLinearOp.getLastHash()) || BigInt(0))
        }
    }

    async changeBy(changeAmount: bigint, after?: MutationOp): Promise<void> {

        let newValue = changeAmount;

        if (after === undefined) {
            const ts = await this.getTerminalUnsettledOps();

            if (ts.size() > 0) {
                const prevChangeOp = ts.values().next().value as CounterChangeOp;
                newValue = newValue + (prevChangeOp.newValue as bigint);
            } else if (this._currentLastLinearOp !== undefined) {
                newValue = newValue + (this._currentLastLinearOp.settledValue as bigint);
            }
        }

        const op = new CounterChangeOp(changeAmount, newValue, this._currentLastLinearOp);

        op.setPrevOps(new HashedSet<MutationOp>().values()); // FIXME

        return this.applyNewOp(op);
    }

    settle(includeOps?: HashedSet<MutationOp>) {

    }

    getUnsettledOps(): Promise<HashedSet<CounterChangeOp>> {

        if (this._currentLastLinearOp === undefined) {
            return this.getAllInitialLinearizableOps();
        } else {
            return this.getAllLinearizableOpsAfter(this._currentLastLinearOp.getLastHash());
        }
    }

    getTerminalUnsettledOps(): Promise<HashedSet<CounterChangeOp>> {

        if (this._currentLastLinearOp === undefined) {
            return this.getTerminalInitialLinearizableOps();
        } else {
            return this.getTerminalLinearizableOpsAfter(this._currentLastLinearOp.getLastHash());
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