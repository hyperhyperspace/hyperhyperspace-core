import { MultiMap } from 'util/multimap';
import { Hash } from '../hashing';
import { HashedObject, HashedSet, HashReference } from '../immutable';
import { ForkableObject } from './ForkableObject';
import { ForkableOp } from './ForkableOp';
import { Queue } from 'util/queue';


abstract class MergeOp extends ForkableOp {

    mergedForkableOps?: HashedSet<HashReference<ForkableOp>>;
    forkPointOp?: HashReference<ForkableOp>;

    constructor(targetObject?: ForkableObject, mergeTargetOps?: IterableIterator<ForkableOp>, forkCausalOps?: IterableIterator<ForkableOp>) {
        super(targetObject, forkCausalOps);

        if (this.targetObject !== undefined) {

            if (mergeTargetOps !== undefined) {
                this.mergedForkableOps = new HashedSet<HashReference<ForkableOp>>();

                for (const forkableOp of mergeTargetOps) {
                    if (!(forkableOp instanceof ForkableOp)) {
                        throw new Error('The mergedForkalbeOps in a ForkableOp need to be instances of ForkableOp as well.');
                    }

                    if (!(forkableOp.getTargetObject().equalsUsingLastHash(this.getTargetObject()))) {
                        throw new Error('The op ' + forkableOp.getLastHash() + ' in mergedForkableOps points to a different targetObject than the op itself.');
                    }

                    this.mergedForkableOps.add(forkableOp.createReference());
                }

                if (this.mergedForkableOps.size() === 0) {
                    this.mergedForkableOps = undefined;
                }

                const forkPoint = this.findForkPoint(mergeTargetOps);
                const forkPointOp = forkPoint.forkPointOp;

                if (forkPointOp !== undefined) {
                    if (!(forkPointOp instanceof ForkableOp)) {
                        throw new Error('The forkPointOp in a ForkableOp need to be instances of ForkableOp as well.');
                    }
    
                    if (!(forkPointOp.getTargetObject().equalsUsingLastHash(this.getTargetObject()))) {
                        throw new Error('The forkPointOp (' + forkPointOp.getLastHash() + ') in mergedForkableOps points to a different targetObject than the op itself.');
                    }
    
                    this.forkPointOp = forkPointOp.createReference();
                }
            }

            

            
        }
    }

    private findForkPoint(mergeTargetOps: IterableIterator<ForkableOp>, references?: Map<Hash, HashedObject>): {forkPointOp?: ForkableOp, toMerge: Set<ForkableOp>} {

        const mergeTargetOpSet = new Map<Hash, ForkableOp>();
        const toVisit = new Queue<{targetOpHash: Hash, opHash: Hash}>();
        const visited = new Map<Hash, ForkableOp>();

        for (const forkableOp of mergeTargetOps) {
            mergeTargetOpSet.set(forkableOp.getLastHash(), forkableOp);
            toVisit.enqueue({targetOpHash: forkableOp.getLastHash(), opHash: forkableOp.getLastHash()});
        }

        // all the ops that need to be merged (values in the multimap indicate which mergeTargetOps contain 'em)
        const mergedContentMap = new MultiMap<Hash, Hash>();
        const mergedNextOps    = new MultiMap<Hash, Hash>();

        // ops that are reachable from all the mergeTargetOps
        const intersectionOps = new Set<Hash>();
        const intersectionNextOps = new MultiMap<Hash, Hash>();

        // ops that are the "first" reachable op in a branch that's reachable from all the mergeTargetOps 
        // (that is: they are in intersectionOps, and none of their successors are)
        let forkPointOps = new Set<Hash>();

        // The following loop will traverse the prevForkableOps of all the mergeTargetOps, finding all the
        // ops that are a predecessor of at least one mergeTargetOp, but not of all of them. These ops need
        // to be merged for sure. It will also build the set forkPointOps, described above, with the objective
        // of finding a single forkPointOp from which all of the intersection will follow (this will be the
        // op at which the ops being merged here "forked").

        while (toVisit.size() > 0) {
            const next = toVisit.dequeue();
            const opHash = next.opHash;
            const op = this.getForkableOp(opHash, references);
            visited.set(opHash, op);

            if (!mergedContentMap.get(opHash).has(next.targetOpHash)) {

                // Invariant 1: mergeContentMap contains a partial closure of the predecessors of the ops in
                //              mergeTargetOps (with the value sets indicating in the successors of which of
                //              the mergeTargetOps each op was found so far).

                mergedContentMap.add(opHash, next.targetOpHash);

                for (const prevOpHash of op.getPrevForkOpHashes()) {
                    mergedNextOps.add(prevOpHash, opHash);
                }
                
                if (mergedContentMap.get(opHash).size === mergeTargetOpSet.size) {
                    intersectionOps.add(opHash);

                    // Invariant 2: forkPointOps contains exactly the set of "initial" ops of intersectionOps
                    //              (ops that are not followed by -in the prevForkableOps set of- any other op
                    //               in intersectionOps).

                    if (intersectionNextOps.get(opHash).size === 0) {
                        forkPointOps.add(opHash);
                    }

                    for (const prevOpHash of op.getPrevForkOpHashes()) {
                        intersectionNextOps.add(prevOpHash, opHash);
                        forkPointOps.delete(prevOpHash);
                    }
                }
            }

            // Stopping condition: if toVisit is empty, there is a single op in forkPointOps, and the op we
            //                     just processed is in intersectionOps, then it is safe to ignore its
            //                     prevForkableOps and end the loop early. In other words, we've found the
            //                     fork point! (Strictly speaking, this may be a predecessor of the fork point
            //                     op, but we'll deal with that later).
            
            //                     To see that any predecessors of op will not change the contents of mergeContentMap
            //                     in any significant way, remember that we only care about the elements there
            //                     that are not in the intersection of all the mergeTargetOps. It is easy to see that
            //                     all the elements in op.prefForkableOps will also be in that intersection, and can
            //                     be safely ignored.

            //                     Finally, since forkPointOps.size === 1, we're sure that there are not several
            //                     diverged paths in the intersection that we still need to follow.

            const stop = toVisit.size() === 0 && forkPointOps.size <= 1 && intersectionOps.has(opHash);
            
            if (!stop) {
                for (const prevOpHash of op.getPrevForkOpHashes()) {
                    toVisit.enqueue({opHash: prevOpHash, targetOpHash: next.targetOpHash})
                }
            }

        }

        let forkPointOpHash: Hash|undefined;

        if (forkPointOps.size === 1) {
            // If we found a single forkPointOp, then see if there's a single-successor line we can move up through.

            forkPointOpHash = forkPointOps.values().next().value as Hash;;

            let allNext = mergedNextOps.get(forkPointOpHash);
            let intNext = intersectionNextOps.get(forkPointOpHash);

            while (allNext.size === 1 && intNext.size === 1) {

                mergedContentMap.deleteKey(forkPointOpHash);
                intersectionOps.delete(forkPointOpHash);

                forkPointOpHash = intNext.values().next().value as Hash;
                forkPointOps = new Set<Hash>([forkPointOpHash]);

                allNext = mergedNextOps.get(forkPointOpHash);
                intNext = intersectionNextOps.get(forkPointOpHash);
            }
        }

        const toMerge = new Set<ForkableOp>();

        for (const candidateOpHash of mergedContentMap.keys()) {
            // If not, we need to add all of the intersection to the set of ops that we need to merge! There is no fork
            // point, the intersection has at least two distinct starting ops.
            if (forkPointOpHash === undefined || !intersectionOps.has(candidateOpHash)) {
                toMerge.add(visited.get(candidateOpHash) as ForkableOp);
            }
        }

        const forkPointOp = forkPointOpHash === undefined?
                                undefined
                          :
                                visited.get(forkPointOpHash) as ForkableOp;

        return { forkPointOp: forkPointOp, toMerge: toMerge};
    }

    private getForkableOp(opHash: Hash, references?: Map<Hash, HashedObject>): ForkableOp {

        let op = references?.get(opHash) as ForkableOp|undefined;

        if (op === undefined) {
            op = this.getTargetObject()._allForkableOps.get(opHash);
        }

        if (op === undefined) {
            throw new Error('Could not get forkable op with hash ' + opHash + ': it was not applied to loaded instance of ' + this.getTargetObject().getLastHash());
        }

        return op;
    }

    getPrevForkOpRefs(): IterableIterator<HashReference<ForkableOp>> {
        if (this.mergedForkableOps === undefined) {
            return [].values();
        } else {
            return this.mergedForkableOps.values();
        }
    }

    getPrevForkOpHashes(): IterableIterator<Hash> {
        return Array.from(this.getPrevForkOpRefs()).map((ref: HashReference<ForkableOp>) => ref.hash).values();

    }
}

export { MergeOp };