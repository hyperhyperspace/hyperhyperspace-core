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

    /*async loadLinearizedOps(ops?: Map<Hash, MutationOp>, opts?: {checkOnly?: boolean, useStore?: boolean}): Promise<{ all: HashedSet<LinearizableOp>, disconnectedFromPrevLinearOp: Set<Hash> }> {

        const all = (opts?.checkOnly||false)? undefined : new HashedSet<LinearizableOp>();
        const reachable = new Set<Hash>();
        const toVisit   = new Set<Hash>();
        const disconnected     = new Set<Hash>();

        // Gather all the prev ops that are not the prevLinearOp:

        for (const opRef of this.getPrevOps()) {
            if (opRef.hash !== this.prevLinearOp?.hash) { // this.prevLinearOp is also in prevOps
                toVisit.add(opRef.hash);                  // (if this is not the 1st linearization),
            }                                             // but ignore it here, we want the "normal" ops.
        }

        let reachedPrevLinearOp = false; // incidentally this implies that an "empty" transition 
                                         // (just start & end ops) will be invalid

        while (toVisit.size > 0) {
            const nextHashToVisit = toVisit.values().next().value as Hash;

            toVisit.delete(nextHashToVisit);
            
            if (nextHashToVisit === this.prevLinearOp?.hash) {
                reachedPrevLinearOp = true;
            } else {

                let op = ops?.get(nextHashToVisit);

                if (op === undefined) {

                    if (opts?.useStore !== undefined && opts.useStore) {
                        const store = this.getStore();
                        const loadedOp = await store.load(nextHashToVisit, false, false);
    
                        if (loadedOp === undefined) {
                            throw new Error('Failed to load a MutationOp for hash ' + nextHashToVisit + ' while fetching linearized ops for ' + this.getLastHash());
                        }

                        if (!(loadedOp instanceof MutationOp)) {
                            throw new Error('Failed to load a MutationOp for hash ' + nextHashToVisit + ' while fetching linearized ops for ' + this.getLastHash());
                        }
    
                        op = loadedOp;
                    } else {
                        throw new Error('MutationOp for hash ' + nextHashToVisit + 'is missing in the provided linearized ops for ' + this.getLastHash());
                        
                    }
                }

                if (this.getTargetObject()._noLinearizationsAsPrevOps && op instanceof LinearOp) {
                    throw new Error('Unexpected LinearizationOp ' + nextHashToVisit + ' found while fetching linearized ops for ' + this.getLastHash());
                }

                if (op instanceof LinearizableOp) {
                    if (!reachable.has(op.getLastHash())) {
                        reachable.add(op.getLastHash());
                        all?.add(op);
    
                        let hasPreds = false;
    
                        for (const opRef of op.getPrevOps()) {
    
                            hasPreds = hasPreds || opRef.hash !== this.prevLinearOp?.hash;
    
                            if (!reachable.has(opRef.hash)) {
                                toVisit.add(opRef.hash);    
                            }
                        }
    
                        if (!hasPreds) {
    
                            if (this.getTargetObject()._noDisconnectedOps && this.prevLinearOp?.hash !== undefined) {
                                throw new Error('Found an unexpected root op: ' + nextHashToVisit + ' in linearization op ' + this.getLastHash());
                            }
    
                            disconnected.add(op.getLastHash());
                        }
                    }
                }

                
            }
        }
        
        if (this.getTargetObject()._enforceContinuity && this.prevLinearOp?.hash !== undefined && !reachedPrevLinearOp) {
            throw new Error('Found no continuity between linearization op ' + this.getLastHash() + ' and its predecessor.');
        }

        return { all: (all||new HashedSet()), disconnectedFromPrevLinearOp: disconnected };

    }*/

    /* This check-only version of the function above (loadLinearizedOps) has better space requirements,
       since it works storing just the hashes (instead of the ops themselves). Should be useful for
       validation. 
       
       Note: if ops is not provided, and none of the mentioned verifications are enabled in the target
             object, this method does nothing, since it would just load stuff that should already be in
             the store.
    */

    /*
    checkLinearizedOps(ops?: Map<Hash, MutationOp>): boolean {


        if (ops !== undefined || this.getTargetObject()._noDisconnectedOps || 
            this.getTargetObject()._enforceContinuity || this.getTargetObject()._noLinearizationsAsPrevOps) {
            
            
            try {
                this.loadLinearizedOps(ops, {checkOnly: true});
            } catch (e: unknown) {
                return false;
            }
        }

        return true;
    }*/

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

        /*

        for (const prevOpRef of (this.prevOps as HashedSet<HashReference<MutationOp>>).values()) {
            const prevOp = references.get(prevOpRef.hash);

            if (prevOp instanceof LinearizableOp) {
                if (this.prevLinearOp?.hash === prevOp.prevLinearizationOp?.hash) {
                    return false;
                }
            }
        }

        if (!this.checkLinearizedOps()) {
            return false;
        }

        */

        return true;
    }
}

export { LinearOp };