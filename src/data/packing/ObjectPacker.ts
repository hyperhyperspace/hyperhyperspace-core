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

    maxObjs: number;
    
    filterPrevOpsFromDeps: (lit: Literal) => Dependency[];

    constructor(store: Store, maxObjs: number) {

        this.store = store;

        this.content       = [];
        this.contentHashes = new Set();
        this.omitted       = new Set();

        this.allowedOmissions = new Set();

        this.maxObjs = maxObjs;

        this.filterPrevOpsFromDeps = (lit: Literal) => {

            const prevOpHashes = HashedSet.elementsFromLiteral(LiteralUtils.getFields(lit)['prevOps']).map(HashReference.hashFromLiteral);

            return lit.dependencies.filter((dep: Dependency) => prevOpHashes.indexOf(dep.hash) < 0);
        };
        
    }

    allowOmission(hash: Hash) {
        this.allowedOmissions.add(hash);
    }

    async allowOmissionWithReferences(hashes: IterableIterator<Hash>, maxAllowedOmissions: number) {

        const toOmitAsSet = new Set<Hash>(hashes);
        const toOmit = Array.from(hashes);

        while (toOmit.length > 0 && this.allowedOmissions.size < maxAllowedOmissions) {

            const nextHash = toOmit.shift() as Hash;
            toOmitAsSet.delete(nextHash);

            this.allowOmission(nextHash);

            const literal = await this.store.loadLiteral(nextHash);

            if (literal !== undefined) {
                for (const dep of literal.dependencies) {
                    if (!this.allowedOmissions.has(dep.hash) && !toOmitAsSet.has(dep.hash)) {
                        toOmitAsSet.add(dep.hash);
                        toOmit.push(dep.hash);
                    }
                }
            }
        }

    }

    async tryToAddObjectWithDeps(hash: Hash, maxObjects: number, filterDeps?: (lit: Literal) => Dependency[]): Promise<boolean> {

        const missing = new Array<Hash>();
        const missingAsSet = new Set<Hash>();
        
        const added   = new Set<Hash>();

        const packed = new Array<Literal>();

        if (!this.contentHashes.has(hash) && !this.allowedOmissions.has(hash)) {
            missing.push(hash);
            missingAsSet.add(hash);    
        }

        while (missing.length > 0 && packed.length <= maxObjects) {

            const nextHash = missing.shift() as Hash;
            missingAsSet.delete(nextHash);

            if (!added.has(nextHash)) {

                // yikes! we really need to add it.
                const literal = await this.store.loadLiteral(nextHash) as Literal;

                packed.unshift(literal);

                let deps = literal.dependencies;
                if (filterDeps !== undefined) {
                    deps = filterDeps(literal);
                }

                for (const dep of deps) {
                    if (!this.contentHashes.has(dep.hash) && 
                        !this.allowedOmissions.has(dep.hash) &&
                        !added.has(dep.hash)) {

                        missing.push(dep.hash);
                        missingAsSet.add(dep.hash);

                    }
                }

            }

        }

        if (missing.length === 0 && packed.length <= maxObjects) {

            for (const literal of packed) {
                this.contentHashes.add(literal.hash);
                this.content.push(literal);
            }

            return true;
        } else {

            return false;
        }



    }

    async addForwardOps(initHistoryHashes: Set<Hash>, causalHistory: CausalHistoryFragment) {



    }

}

export { ObjectPacker };