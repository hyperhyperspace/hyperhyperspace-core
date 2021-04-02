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
    omitted       : Set<Hash>;

    allowedOmissions: Set<Hash>;

    maxLiterals: number;
    
    filterPrevOpsFromDeps: (lit: Literal) => Dependency[];

    constructor(store: Store, maxLiterals: number) {

        this.store = store;

        this.content       = [];
        this.contentHashes = new Set();
        this.omitted       = new Set();

        this.allowedOmissions = new Set();

        this.maxLiterals = maxLiterals;

        this.filterPrevOpsFromDeps = (lit: Literal) => {

            const prevOpHashes = HashedSet.elementsFromLiteral(LiteralUtils.getFields(lit)['prevOps']).map(HashReference.hashFromLiteral);

            return lit.dependencies.filter((dep: Dependency) => prevOpHashes.indexOf(dep.hash) < 0);
        };
        
    }

    allowOmission(hash: Hash) {
        this.allowedOmissions.add(hash);
    }

    async allowOmissionsRecursively(initialHashesToOmit: IterableIterator<Hash>, maxAllowedOmissions: number) {

        const omittableRefs = Array.from(initialHashesToOmit);
        const omittableRefsAsSet = new Set<Hash>(initialHashesToOmit);
        

        while (omittableRefs.length > 0 && this.allowedOmissions.size < maxAllowedOmissions) {

            const nextHash = omittableRefs.shift() as Hash;
            omittableRefsAsSet.delete(nextHash);

            this.allowOmission(nextHash);

            const literal = await this.store.loadLiteral(nextHash);

            if (literal !== undefined) {
                for (const dep of literal.dependencies) {
                    if (!this.allowedOmissions.has(dep.hash) && !omittableRefsAsSet.has(dep.hash)) {
                        omittableRefsAsSet.add(dep.hash);
                        omittableRefs.push(dep.hash);
                    }
                }
            }
        }

    }

    async addObject(hash: Hash): Promise<boolean> {

        if (this.contentHashes.has(hash)) {
            return true;
        } else {
            const literals = await this.toMissingLiterals(hash, this.maxLiterals - this.content.length);

            if (literals !== undefined) {
    
                // Since literals is in inverse causal order, its elements should be reversed 
                // when added to the pack.
    
                while (literals.length > 0) {
                    const literal = literals.pop() as Literal;
                    this.content.push();
                    this.contentHashes.add(literal.hash);
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

    // toMissingLiterals impotant note: the literal array is in inverse causal order.
    //                                  (i.e. the last element should be applied first)

    private async toMissingLiterals(hash: Hash, maxAllowedLiterals: number): Promise<Literal[]|undefined> {

        const missing = new Array<Hash>();
        const missingAsSet = new Set<Hash>();

        const packed       = new Array<Literal>();
        const packedHashes = new Set<Hash>();

        if (!this.contentHashes.has(hash) && !this.allowedOmissions.has(hash)) {
            missing.push(hash);
            missingAsSet.add(hash);    
        }

        while (missing.length > 0 && packed.length < maxAllowedLiterals) {

            const nextHash = missing.pop() as Hash;
            missingAsSet.delete(nextHash);

            const literal = await this.store.loadLiteral(nextHash) as Literal;

            packed.push(literal);
            packedHashes.add(nextHash);

            let deps = literal.dependencies;

            for (const dep of deps) {
                if (!this.contentHashes.has(dep.hash) && 
                    !this.allowedOmissions.has(dep.hash) &&
                    !packedHashes.has(dep.hash)) {

                    missing.push(dep.hash);
                    missingAsSet.add(dep.hash);
                }
            }

        }

        if (missing.length === 0) {
            return packed;
        } else {
            return undefined;
        }



    }

}

export { ObjectPacker };