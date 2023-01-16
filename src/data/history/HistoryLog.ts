import { Hash, HashedObject, HashedSet, MutableObject, MutationOp } from '../model';
import { HistoryFragment } from '../history';
import { MultiMap } from 'util/multimap';
import { ArrayMap } from 'util/arraymap';

class StateTransition<T extends MutableObject> extends MutationOp {

    static className = 'hss/v0/HistoryLog/StateTransition';

    mutableHash?: Hash;
    start?: Hash;
    end?: Hash;

    info?: any;

    constructor(log: HistoryLog<T>, mutableHash?: Hash, start?: Hash, end?: Hash, info?: any) {
        super(log);

        this.mutableHash = mutableHash;
        this.start       = start;
        this.end         = end;

        this.info     = info;
    }

    getClassName(): string {
        return StateTransition.className;
    }

    init(): void {
        
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        return await super.validate(references) &&
               typeof(this.mutableHash) === 'string' && 
               (this.start === undefined || typeof(this.start) === 'string') && 
               typeof(this.end) === 'string' &&
               (this.info === undefined || HashedObject.isLiteral(this.info));
    }
}

class VerifiedStateTransition<T extends MutableObject> extends StateTransition<T> {

    static className = 'hss/v0/HistoryLog/VerifiedStateTransition';

    mutable?: T;
    ops?: HashedSet<MutationOp>;

    constructor(log: HistoryLog<T>, mutable?: T, start?: Hash, end?: Hash, info?: any, ops?: Map<Hash, MutationOp>) {
        super(log, mutable?.getLastHash(), start, end, info);

        this.mutable = mutable;
        this.ops = new HashedSet(ops?.values());
    }
    getClassName(): string {
        return VerifiedStateTransition.className;
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        if (!(await super.validate(references))) {
            return false;
        }

        if (this.mutable?.getLastHash() !== this.mutableHash) {
            return false;
        }

        const frag = new HistoryFragment(this.mutableHash as Hash);

        if (!(this.ops instanceof HashedSet)) {
            return false;
        }

        for (const op of this.ops?.values()) {
            if (!(op instanceof MutationOp)) {
                return false;
            }

            if (!(op.getTargetObject().getLastHash() !== this.mutable?.getLastHash())) {
                return false;
            }

            const opHeader = await this.mutable?.getOpHeader(op.getLastHash());

            if (opHeader === undefined) {
                return false;
            }

            frag.add(opHeader);
        }

        const start = new HashedSet<Hash>(frag.getStartingOps().values());
        const end = new HashedSet<Hash>(frag.getTerminalOps().values());

        if (this.start !== start.hash()) {
            return false;
        }

        if (this.end !== end.hash()) {
            return false;
        }

        return true;
    }
}

class HistoryLogEntry<T extends MutableObject> extends MutationOp {

    static className = 'hss/v0/HistoryLog/Entry';

    transitions?: HashedSet<StateTransition<T>>;

    constructor(transitions?: HashedSet<StateTransition<T>>) {
        super();
        this.transitions = transitions;
    }

    getClassName(): string {
        return HistoryLogEntry.className;
    }

    init(): void {
        
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {

        if (!(await super.validate(references))) {
            return false;
        }

        if (!(this.transitions instanceof HashedSet)) {
            return false;
        }

        //const seen = new Set<Hash>();

        for (const transition of this.transitions.values()) {

            if (!(transition instanceof StateTransition)) {
                return false;
            }

            /*if (seen.has(transition.mutable as Hash)) {
                return false;
            }

            seen.add(transition.mutable as Hash);*/
        }

        return true;
    }
    
}

abstract class HistoryLog<T extends MutableObject> extends MutableObject {

    _transitions: ArrayMap<Hash, StateTransition<T>>;
    _pending: ArrayMap<Hash, StateTransition<T>>;

    _faulted: MultiMap<Hash, StateTransition<T>>;

    constructor() {
        super([StateTransition.className, VerifiedStateTransition.className, HistoryLogEntry.className], {supportsUndo: false});

        this._transitions = new ArrayMap(false);
        this._pending     = new ArrayMap(false);

        this._faulted     = new MultiMap();
    }

    async attemptTransition(fragment: HistoryFragment, timeout?: number): Promise<HistoryLogEntry<T>> {

        timeout;

        this.createAttemptTransitionOp(fragment);
        
        throw new Error('Unfinished');
    }
    async attemptVerifiedTransition(fragment: HistoryFragment, mut: T, ops: Map<Hash, MutationOp>, timeout?: number): Promise<boolean> {

        timeout;

        this.createAttemptTransitionOp(fragment, mut, ops);

        throw new Error('Unfinished');
    }

    private async createAttemptTransitionOp(fragment: HistoryFragment, mut?: T, ops?: Map<Hash, MutationOp>) {
        fragment; mut; ops;
        throw new Error('unfinished');
    }
    
    getLastTransition(mut: Hash): (StateTransition<T>|undefined) {
        
        const txs = this._transitions.get(mut);

        if (txs.length > 0) {
            return txs[-1];
        } else {
            return undefined;
        }

    }

    mutate(op: MutationOp, valid: boolean, cascade: boolean): Promise<boolean> {
        
        valid; cascade;

        if (op instanceof StateTransition) {
            
            this._pending.add(op.mutableHash as Hash, op);
        } else if (op instanceof HistoryLogEntry) {

        }

        throw new Error('unfinished')
    }

    getMutableContents(): MultiMap<string, HashedObject> {
        return new MultiMap();
    }

    getMutableContentByHash(_hash: string): Set<HashedObject> {
        return new Set();
    }

    getClassName(): string {
        throw new Error('Method not implemented.');
    }

    init(): void {
        throw new Error('Method not implemented.');
    }

    validate(_references: Map<string, HashedObject>): Promise<boolean> {
        throw new Error('Method not implemented.');
    }

}

export { HistoryLog };