import { Hash } from '../hashing';
import { HashedObject, HashedSet, HashReference } from '../immutable';
import { MutationOp } from '../mutable';
import { LinearObject } from './LinearObject';

abstract class LinearizationOp extends MutationOp {

    seq?: bigint;

    prevLinearOp?: HashReference<this>;
    linearCausalOps?: HashedSet<LinearizationOp>;

    constructor(targetObject?: LinearObject, prevLinearOp?: LinearizationOp, linearCausalOps?: IterableIterator<LinearizationOp>) {
        super(targetObject);

        this.seq = prevLinearOp === undefined? BigInt(0) : (prevLinearOp.seq as bigint) + BigInt(1);
        
        this.prevLinearOp = prevLinearOp?.createReference();

        if (linearCausalOps !== undefined) {
            this.linearCausalOps = new HashedSet(linearCausalOps);

            if (this.linearCausalOps.size() === 0) {
                this.linearCausalOps = undefined;
            }
        }        
    }

    async loadLinearizedOps(ops?: Map<Hash, MutationOp>, opts?: {checkOnly?: boolean, useStore?: boolean}): Promise<{ all: HashedSet<MutationOp>, disconnectedFromPrevLinearOp: Set<Hash> }> {

        const all = (opts?.checkOnly||false)? undefined : new HashedSet<MutationOp>();
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

                if (this.getTargetObject()._noLinearizationsAsPrevOps && op instanceof LinearizationOp) {
                    throw new Error('Unexpected LinearizationOp ' + nextHashToVisit + ' found while fetching linearized ops for ' + this.getLastHash());
                }

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
        
        if (this.getTargetObject()._enforceContinuity && this.prevLinearOp?.hash !== undefined && !reachedPrevLinearOp) {
            throw new Error('Found no continuity between linearization op ' + this.getLastHash() + ' and its predecessor.');
        }

        return { all: (all||new HashedSet()), disconnectedFromPrevLinearOp: disconnected };

    }

    /* This check-only version of the function above (loadLinearizedOps) has better space requirements,
       since it works storing just the hashes (instead of the ops themselves). Should be useful for
       validation. 
       
       Note: if ops is not provided, and none of the mentioned verifications are enabled in the target
             object, this method does nothing, since it would just load stuff that should already be in
             the store.
    */

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
    }

    gerPrevLinearOpHash(): Hash {
        if (this.prevLinearOp === undefined) {
            throw new Error('LinearObject: prevLinearOp reference is missing, but its hash was requested.');
        }

        return this.prevLinearOp.hash;
    }

    getLinearCausalOps(): HashedSet<LinearizationOp> {
        if (this.linearCausalOps === undefined) {
            throw new Error('LinearObject: linearOpDeps was requested, but it is missing.');
        }

        return this.linearCausalOps;
    }

    getTargetObject(): LinearObject {
        return super.getTargetObject() as LinearObject;
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        
        if (!(await super.validate(references))) {
            return false;
        }

        if (!(typeof(this.seq) === 'bigint')) {
            return false;
        }

        if (this.prevLinearOp === undefined) {
            if (this.seq !== BigInt(0)) {
                return false;
            }
        } else {

            if (this.prevOps === undefined || !this.prevOps.has(this.prevLinearOp)) {
                return false;
            }

            const prev = references.get(this.prevLinearOp.hash);

            if (!(prev instanceof LinearizationOp)) {
                return false;
            }

            if (this.seq + BigInt(1) !== prev.seq) {
                return false;
            }
        }

        if (!this.checkLinearizedOps()) {
            return false;
        }

        return true;
    }
}

export { LinearizationOp };