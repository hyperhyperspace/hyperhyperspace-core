import { CausalHistoryFragment } from 'data/history/CausalHistoryFragment';
import { Hash } from 'data/model/Hashing';
import { Store } from 'storage/store';
import { ObjectPacker } from './ObjectPacker';


class CausalHistoryObjectPacker extends ObjectPacker {

    causalHistory: CausalHistoryFragment

    constructor(causalHistory: CausalHistoryFragment, store: Store, maxLiterals: number) {
        super(store, maxLiterals);
        this.causalHistory = causalHistory;
    }


    // Attempt to add all causal history ops and their needed dependencies
    // starting from the given set until the very last ones.

    // If successful, return true. If there are more ops to send, return
    // false.
    async addForwardOps(initHistoryHashes: Set<Hash>): Promise<boolean> {

        for (const opHistory of this.causalHistory.reachableFrom(initHistoryHashes, 'forward')) {
            if (!await this.addObject(opHistory.opHash)) {
                return false;
            }
        }

        return true;
    }

}

export { CausalHistoryObjectPacker };