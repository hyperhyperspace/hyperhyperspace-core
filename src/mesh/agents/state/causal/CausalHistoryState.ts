import { Hash, HashedObject, HashedSet } from 'data/model';
import { Store } from 'storage/store';


class CausalHistoryState extends HashedObject {

    static className = 'hhs/v0/CausalHistoryState';

    mutableObj?  : Hash;
    terminalOpHistories? : HashedSet<Hash>;

    static async createFromTerminalOps(mutableObj: Hash, terminalOps: Array<Hash>, store: Store): Promise<CausalHistoryState> {

        const terminalOpHistories: Array<Hash> = [];

        for (const opHash of terminalOps) {
            const history = await store.loadOpCausalHistory(opHash);
            terminalOpHistories.push(history?.causalHistoryHash as Hash);
        }

        return CausalHistoryState.create(mutableObj, terminalOpHistories);
    }

    static create(target: Hash, terminalOpHistories: Array<Hash>) {
        return new CausalHistoryState(target, terminalOpHistories);
    }

    constructor(mutableObj?: Hash, terminalOpHistories?: Array<Hash>) {
        super();

        this.mutableObj = mutableObj;
        if (terminalOpHistories !== undefined) { 
            this.terminalOpHistories = new HashedSet<Hash>(new Set(terminalOpHistories).values());
        } else {
            this.terminalOpHistories = new HashedSet<Hash>();
        }
    }

    getClassName() {
        return CausalHistoryState.className;
    }

    validate(_references: Map<Hash, HashedObject>) {

        if (this.mutableObj === undefined) {
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

HashedObject.registerClass(CausalHistoryState.className, CausalHistoryState);

export { CausalHistoryState };