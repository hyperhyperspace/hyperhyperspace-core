import { Hash } from '../hashing';
import { HashedObject, HashReference } from '../immutable';

import { ForkableObject } from './ForkableObject';
import { ForkableOp } from './ForkableOp';

abstract class LinearOp extends ForkableOp {

    prevForkableOp?: HashReference<ForkableOp>;

    constructor(targetObject?: ForkableObject, prevForkableOp?: ForkableOp, forkCausalOps?: IterableIterator<ForkableOp>) {
        super(targetObject, forkCausalOps);

        if (this.targetObject !== undefined) {

            if (prevForkableOp !== undefined) {
                if (!targetObject?.equalsUsingLastHash(prevForkableOp?.getTargetObject())) {
                    throw new Error('Cannot create LinearOp: prevForkableOp ' + prevForkableOp?.getLastHash() + ' has a different ForkableObject as target');
                }
            }
        }
                
    }

    getPrevForkOpRefs(): IterableIterator<HashReference<ForkableOp>> {
        const r = new Array<HashReference<ForkableOp>>();

        if (this.prevForkableOp !== undefined) {
            r.push(this.prevForkableOp);
        }

        return r.values();
    }

    getPrevForkOpHashes(): IterableIterator<Hash> {
        const r = new Array<Hash>();

        if (this.prevForkableOp !== undefined) {
            r.push(this.prevForkableOp.hash);
        }

        return r.values();
    }

    gerPrevForkableOpHash(): Hash {
        if (this.prevForkableOp === undefined) {
            throw new Error('ForkableObject: prevForkableOp reference is missing, but its hash was requested.');
        }

        return this.prevForkableOp.hash;
    }

    getTargetObject(): ForkableObject {
        return super.getTargetObject() as ForkableObject;
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        
        if (!(await super.validate(references))) {
            return false;
        }

        if (this.prevForkableOp !== undefined) {

            if (this.prevOps === undefined || !this.prevOps.has(this.prevForkableOp)) {
                return false;
            }

            const prev = references.get(this.prevForkableOp.hash);

            if (!(prev instanceof LinearOp)) {
                return false;
            }
        }

        return true;
    }
}

export { LinearOp };