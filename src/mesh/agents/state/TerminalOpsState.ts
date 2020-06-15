import { HashedObject } from 'data/model/HashedObject';
import { Hash } from 'data/model/Hashing';
import { HashedSet } from 'data/model/HashedSet';


class TerminalOpsState extends HashedObject {
    
    static className = 'hhs/TerminalOpsState';

    objectHash?  : Hash;
    terminalOps? : HashedSet<Hash>;

    static create(objectHash: Hash, terminalOps: Array<Hash>) {
        return new TerminalOpsState(objectHash, terminalOps);
    }

    constructor(objectHash?: Hash, terminalOps?: Array<Hash>) {
        super();

        this.objectHash = objectHash;
        if (terminalOps !== undefined) { 
            this.terminalOps = new HashedSet<Hash>(new Set(terminalOps).values());
        }
    }

    getClassName() {
        return TerminalOpsState.className;
    }

    init() {
        if (this.objectHash === undefined || this.terminalOps === undefined) {
            throw new Error("Missing fields in TerminalOpsState");
        }
    }
}

TerminalOpsState.registerClass(TerminalOpsState.className, TerminalOpsState);

export { TerminalOpsState };