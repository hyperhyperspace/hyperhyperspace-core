import { OpHeader, OpHeaderLiteral } from 'data/history/OpHeader';
import { Hash, HashedObject, HashedSet } from 'data/model';
import { Store } from 'storage/store';



class HeaderBasedState extends HashedObject {

    static className = 'hhs/v0/CausalHistoryState';

    mutableObj?  : Hash;
    terminalOpHeaderHashes? : HashedSet<Hash>;
    terminalOpHeaders? : HashedSet<OpHeaderLiteral>;

    static async createFromTerminalOps(mutableObj: Hash, terminalOps: Array<Hash>, store: Store): Promise<HeaderBasedState> {

        const terminalOpHeaders: Array<OpHeader> = [];

        for (const opHash of terminalOps) {
            const history = await store.loadOpHeader(opHash);
            terminalOpHeaders.push(history as OpHeader);
            
        }

        return HeaderBasedState.create(mutableObj, terminalOpHeaders);
    }

    static create(target: Hash, terminalOpHistories: Array<OpHeader>) {
        return new HeaderBasedState(target, terminalOpHistories);
    }

    constructor(mutableObj?: Hash, terminalOpHistories?: Array<OpHeader>) {
        super();

        this.mutableObj = mutableObj;
        if (terminalOpHistories !== undefined) { 
            this.terminalOpHeaderHashes = new HashedSet<Hash>(new Set(terminalOpHistories.map((h: OpHeader) => h.headerHash)).values());
            this.terminalOpHeaders     = new HashedSet<OpHeaderLiteral>(new Set(terminalOpHistories.map((h: OpHeader) => h.literalize())).values());
        } else {
            this.terminalOpHeaderHashes = new HashedSet<Hash>();
            this.terminalOpHeaders     = new HashedSet<OpHeaderLiteral>();
        }
    }

    getClassName() {
        return HeaderBasedState.className;
    }

    async validate(_references: Map<Hash, HashedObject>) {

        if (this.mutableObj === undefined) {
            return false;
        }

        if (this.terminalOpHeaderHashes === undefined || !(this.terminalOpHeaderHashes instanceof HashedSet)) {
            return false;
        }

        if (this.terminalOpHeaders == undefined || !(this.terminalOpHeaders instanceof HashedSet)) {
            return false;
        }

        for (const hash of this.terminalOpHeaderHashes.values()) {
            if (typeof(hash) !== 'string') {
                return false;
            }
        }

        const checkHashes = new HashedSet<Hash>();
        for (const hashedLit of this.terminalOpHeaders?.values()) {

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

        if (!this.terminalOpHeaderHashes.equals(checkHashes)) {
            return false;
        }

        return true;
    }

    init() {

    }

}

HashedObject.registerClass(HeaderBasedState.className, HeaderBasedState);

export { HeaderBasedState };