import { Hash, HashedObject, HashedSet } from 'data/model';
import { Store } from 'storage/store';


class CausalHistoryState extends HashedObject {

    static className = 'hhs/v0/CausalHistoryState';

    target?  : Hash;
    terminalOpHistories? : HashedSet<Hash>;

    static async createFromTerminalOps(target: Hash, terminalOps: Array<Hash>, store: Store): Promise<CausalHistoryState> {

        const terminalOpHistories: Array<Hash> = [];

        for (const opHash of terminalOps) {
            const history = await store.loadOpCausalHistory(opHash);
            terminalOpHistories.push(history?.causalHistoryHash as Hash);
        }

        return CausalHistoryState.create(target, terminalOpHistories);
    }

    static create(target: Hash, terminalOpHistories: Array<Hash>) {
        return new CausalHistoryState(target, terminalOpHistories);
    }

    constructor(objectHash?: Hash, terminalOpHistories?: Array<Hash>) {
        super();

        this.target = objectHash;
        if (terminalOpHistories !== undefined) { 
            this.terminalOpHistories = new HashedSet<Hash>(new Set(terminalOpHistories).values());
        }
    }

    getClassName() {
        return CausalHistoryState.className;
    }

    validate(_references: Map<Hash, HashedObject>) {

        if (this.target === undefined) {
            return false;
        }

        if (this.terminalOpHistories === undefined || !(this.terminalOpHistories instanceof HashedSet)) {
            return false;
        }

        for (const hash of this.terminalOpHistories.values()) {
            if (typeof(hash) !== 'string') {
                return false;
            }
        }

        return true;
    }

    init() {

    }

}

export { CausalHistoryState };