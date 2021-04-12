import { CausalHistoryFragment } from 'data/history/CausalHistoryFragment';
import { HashedSet } from 'data/model/HashedSet';
import { Hash } from 'data/model/Hashing';
import { HashReference } from 'data/model/HashReference';
import { Dependency, Literal, LiteralUtils } from 'data/model/Literals';
import { Store } from 'storage/store';


class ObjectPacker {

    store: Store;

    content       : Array<Literal>;
    contentHashes : Set<Hash>;
    omissions     : Map<Hash, Hash[]>;

    allowedOmissions: Map<Hash, Hash[]>;

    maxLiterals: number;
    
    filterPrevOpsFromDeps: (lit: Literal) => Dependency[];

    constructor(store: Store, maxLiterals: number) {

        this.store = store;

        this.content       = [];
        this.contentHashes = new Set();

        this.omissions = new Map();

        this.allowedOmissions = new Map();

        this.maxLiterals = maxLiterals;

        this.filterPrevOpsFromDeps = (lit: Literal) => {

            const prevOpHashes = HashedSet.elementsFromLiteral(LiteralUtils.getFields(lit)['prevOps']).map(HashReference.hashFromLiteral);

            return lit.dependencies.filter((dep: Dependency) => prevOpHashes.indexOf(dep.hash) < 0);
        };
        
    }

    allowOmission(hash: Hash, referenceChain: Hash[]) {

        if (!this.allowedOmissions.has(hash)) {
            this.allowedOmissions.set(hash, referenceChain);
        }
        
    }

    async allowOmissionsRecursively(initialHashesToOmit: IterableIterator<Hash>, maxAllowedOmissions?: number, isAdditionalReferenceRoot?: (literal: Literal) => boolean) {

        const omittableRefsQueue = Array.from(initialHashesToOmit);
        const omittableRefs = new Set<Hash>();
        const refChains = new Map<Hash, Hash[]>();

        for (const hash of omittableRefsQueue) {
            omittableRefs.add(hash)
            refChains.set(hash, [hash]);
        }

        while (omittableRefsQueue.length > 0 && (maxAllowedOmissions === undefined || this.allowedOmissions.size < maxAllowedOmissions)) {

            const nextHash = omittableRefsQueue.shift() as Hash;
            const literal = await this.store.loadLiteral(nextHash);

            if (literal !== undefined) {

                let refChain = refChains.get(nextHash) as Hash[];            

                if (isAdditionalReferenceRoot !== undefined && isAdditionalReferenceRoot(literal)) {
                    refChain = [nextHash];
                }
    
                this.allowOmission(nextHash, refChain);
                console.log('allowing omission of ' + nextHash + ' with chain:')
                console.log(refChain)
                
                for (const dep of literal.dependencies) {
                    if (!this.allowedOmissions.has(dep.hash) && !omittableRefs.has(dep.hash)) {

                        omittableRefs.add(dep.hash);
                        omittableRefsQueue.push(dep.hash);

                        const depRefChain = refChain.slice();
                        depRefChain.push(dep.hash);

                        refChains.set(dep.hash, depRefChain);
                    }
                }
            }
        }

    }

    async addObject(hash: Hash): Promise<boolean> {

        if (this.contentHashes.has(hash)) {
            return true;
        } else {
            const result = await this.attemptToAdd(hash, this.maxLiterals - this.content.length);

            if (result !== undefined) {
    
                // Since literals is in inverse causal order, its elements should be reversed 
                // when added to the pack.
    
                while (result.literals.length > 0) {
                    const literal = result.literals.pop() as Literal;
                    this.content.push(literal);
                    this.contentHashes.add(literal.hash);
                }
    
                for (const hash of result.omitted.keys()) {

                    // We're currently computing two different reference chains: attemptToAdd will return
                    // how the added object references the omitted one, while this.allowedOmissions has
                    // the ref chain saved back from when the omission was allowed.

                    // We're currently using the second one, so the verifier can verify just as he receives
                    // his response, and withouth risking leaking any information unrelated to the mutable
                    // being synchronized.

                    this.omissions.set(hash, this.allowedOmissions.get(hash) as Hash[]);
                }

                return true;
            } else {
                return false;
            }
        }
        

    }

    // Attempt to add all causal history ops and their needed dependencies
    // starting from the given set until the very last ones.

    // If successful, return true. If there are more ops to send, return
    // false.
    async addForwardOps(initHistoryHashes: Set<Hash>, causalHistory: CausalHistoryFragment): Promise<boolean> {

        for (const opHistory of causalHistory.iterateFrom(initHistoryHashes, 'forward')) {
            if (!await this.addObject(opHistory.opHash)) {
                return false;
            }
        }

        return true;
    }


    // attemptToadd impotant note: the literal array is in inverse causal order.
    //                             (i.e. the last element should be applied first)

    private async attemptToAdd(hash: Hash, maxAllowedLiterals: number): Promise<{literals:Literal[], omitted: Map<Hash, Hash[]>}|undefined> {

        const queued = new Array<Array<Hash>>();

        const packed       = new Array<Literal>();
        const packedHashes = new Set<Hash>();

        const omitted      = new Map<Hash, Array<Hash>>();

        const currentReferenceChain = new Array<Hash>();

        if (!this.contentHashes.has(hash) && !this.allowedOmissions.has(hash)) {
            queued.push([hash]);
        }

        while (queued.length > 0 && packed.length < maxAllowedLiterals) {

            const nextHashes = queued.pop() as Hash[];

            if (nextHashes.length === 0) {
                currentReferenceChain.pop();
            } else {
                const nextHash = nextHashes.shift() as Hash;
                queued.push(nextHashes);

                if (!this.contentHashes.has(nextHash) && !packedHashes.has(nextHash) && !omitted.has(nextHash)) {

                    if (this.allowedOmissions.has(nextHash)) {
                        omitted.set(nextHash, currentReferenceChain.slice());
                    } else {
                        const literal = await this.store.loadLiteral(nextHash) as Literal;

                        packed.push(literal);
                        packedHashes.add(literal.hash);

                        const deps = literal.dependencies.map((d: Dependency) => d.hash);

                        queued.push(deps);
                        currentReferenceChain.push(nextHash);
                    }

                }       
            }
        }

        if (queued.length === 0) {
            return { literals: packed, omitted: omitted};
        } else {
            return undefined;
        }
    }

}

export { ObjectPacker };