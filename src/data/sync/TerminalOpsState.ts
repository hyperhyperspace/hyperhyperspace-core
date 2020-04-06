import { HashedObject } from "data/model/HashedObject";
import { Hash } from 'data/model/Hashing';
import { HashedSet } from 'data/model/HashedSet';
import { MutationOp } from 'data/model/MutationOp';


class TerminalOpsState extends HashedObject {
    
    objectHash?  : Hash;
    terminalOps? : HashedSet<Hash>;

    static create(objectHash: Hash, terminalOps: Array<Hash>) {
        return new TerminalOpsState(objectHash, terminalOps);
    }

    constructor(objectHash?: Hash, terminalOps?: Array<Hash>) {
        super();

        this.objectHash = objectHash;
        this.terminalOps = new HashedSet<Hash>(new Set(terminalOps).values());
    }
}

export { TerminalOpsState };