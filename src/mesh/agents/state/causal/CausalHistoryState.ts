import { OpHeader, OpHeaderLiteral } from 'data/history/OpHeader';
import { Hash, HashedObject, HashedSet } from 'data/model';
import { Store } from 'storage/store';



class CausalHistoryState extends HashedObject {

    static className = 'hhs/v0/CausalHistoryState';

    mutableObj?  : Hash;
    terminalOpHistoryHashes? : HashedSet<Hash>;
    terminalOpHistories? : HashedSet<OpHeaderLiteral>;

    static async createFromTerminalOps(mutableObj: Hash, terminalOps: Array<Hash>, store: Store): Promise<CausalHistoryState> {

        const terminalOpHistories: Array<OpHeader> = [];

        for (const opHash of terminalOps) {
            const history = await store.loadOpHeader(opHash);
            terminalOpHistories.push(history as OpHeader);
            
        }

        return CausalHistoryState.create(mutableObj, terminalOpHistories);
    }

    static create(target: Hash, terminalOpHistories: Array<OpHeader>) {
        return new CausalHistoryState(target, terminalOpHistories);
    }

    constructor(mutableObj?: Hash, terminalOpHistories?: Array<OpHeader>) {
        super();

        this.mutableObj = mutableObj;
        if (terminalOpHistories !== undefined) { 
            this.terminalOpHistoryHashes = new HashedSet<Hash>(new Set(terminalOpHistories.map((h: OpHeader) => h.headerHash)).values());
            this.terminalOpHistories     = new HashedSet<OpHeaderLiteral>(new Set(terminalOpHistories.map((h: OpHeader) => h.literalize())).values());
        } else {
            this.terminalOpHistoryHashes = new HashedSet<Hash>();
            this.terminalOpHistories     = new HashedSet<OpHeaderLiteral>();
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
                const h = new OpHeader(hashedLit);

                if (h.opHash != this.mutableObj) {
                    return false;
                }

                checkHashes.add(h.headerHash);

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