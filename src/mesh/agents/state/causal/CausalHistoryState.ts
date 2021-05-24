import { OpCausalHistory, OpCausalHistoryLiteral } from 'data/history/OpCausalHistory';
import { Hash, HashedObject, HashedSet } from 'data/model';
import { Store } from 'storage/store';



class CausalHistoryState extends HashedObject {

    static className = 'hhs/v0/CausalHistoryState';

    mutableObj?  : Hash;
    terminalOpHistoryHashes? : HashedSet<Hash>;
    terminalOpHistories? : HashedSet<OpCausalHistoryLiteral>;

    static async createFromTerminalOps(mutableObj: Hash, terminalOps: Array<Hash>, store: Store): Promise<CausalHistoryState> {

        const terminalOpHistories: Array<OpCausalHistory> = [];

        for (const opHash of terminalOps) {
            const history = await store.loadOpCausalHistory(opHash);
            terminalOpHistories.push(history as OpCausalHistory);
            
        }

        return CausalHistoryState.create(mutableObj, terminalOpHistories);
    }

    static create(target: Hash, terminalOpHistories: Array<OpCausalHistory>) {
        return new CausalHistoryState(target, terminalOpHistories);
    }

    constructor(mutableObj?: Hash, terminalOpHistories?: Array<OpCausalHistory>) {
        super();

        this.mutableObj = mutableObj;
        if (terminalOpHistories !== undefined) { 
            this.terminalOpHistoryHashes = new HashedSet<Hash>(new Set(terminalOpHistories.map((h: OpCausalHistory) => h.causalHistoryHash)).values());
            this.terminalOpHistories     = new HashedSet<OpCausalHistoryLiteral>(new Set(terminalOpHistories.map((h: OpCausalHistory) => h.literalize())).values());
        } else {
            this.terminalOpHistoryHashes = new HashedSet<Hash>();
            this.terminalOpHistories     = new HashedSet<OpCausalHistoryLiteral>();
        }
    }

    getClassName() {
        return CausalHistoryState.className;
    }

    async validate(_references: Map<Hash, HashedObject>) {

        if (this.mutableObj === undefined) {
            return false;
        }

        if (this.terminalOpHistoryHashes === undefined || !(this.terminalOpHistoryHashes instanceof HashedSet)) {
            return false;
        }

        if (this.terminalOpHistories == undefined || !(this.terminalOpHistories instanceof HashedSet)) {
            return false;
        }

        for (const hash of this.terminalOpHistoryHashes.values()) {
            if (typeof(hash) !== 'string') {
                return false;
            }
        }

        const checkHashes = new HashedSet<Hash>();
        for (const hashedLit of this.terminalOpHistories?.values()) {

            if (hashedLit === undefined) {
                return false;
            }

            try {
                const h = new OpCausalHistory(hashedLit);

                if (h.opHash != this.mutableObj) {
                    return false;
                }

                checkHashes.add(h.causalHistoryHash);

            } catch (e) {
                return false;
            }
        }

        if (!this.terminalOpHistoryHashes.equals(checkHashes)) {
            return false;
        }

        return true;
    }

    init() {

    }

}

HashedObject.registerClass(CausalHistoryState.className, CausalHistoryState);

export { CausalHistoryState };