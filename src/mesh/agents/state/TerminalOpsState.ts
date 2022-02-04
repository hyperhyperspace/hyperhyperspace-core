import { HashedObject, HashedSet } from 'data/model/immutable';
import { Hash } from 'data/model/Hashing';


class TerminalOpsState extends HashedObject {
    
    static className = 'hhs/v0/TerminalOpsState';

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

    async validate(references: Map<Hash, HashedObject>) {
        references;
        return this.objectHash !== undefined && this.terminalOps !== undefined;
    }

    init() {

    }
}

TerminalOpsState.registerClass(TerminalOpsState.className, TerminalOpsState);

export { TerminalOpsState };