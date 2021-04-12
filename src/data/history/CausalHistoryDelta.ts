import { Hash } from 'data/model/Hashing';
import { Store } from 'storage/store';
import { CausalHistoryFragment } from './CausalHistoryFragment';
import { OpCausalHistory } from './OpCausalHistory';


class CausalHistoryDelta {

    mutableObj: Hash;

    store: Store;

    fragment: CausalHistoryFragment;
    start: CausalHistoryFragment;

    gap: Set<Hash>;

    constructor(mutableObj: Hash, store: Store) {

        this.mutableObj = mutableObj;
        this.store = store;

        this.fragment = new CausalHistoryFragment(mutableObj);
        this.start = new CausalHistoryFragment(mutableObj);

        this.gap = new Set<Hash>();
    }

    async compute(targetOpHistories: Array<Hash>, startingOpHistories: Array<Hash>, maxDeltaSize: number, maxBacktrackSize: number) {

        for (const hash of startingOpHistories) {
            const opHistory = await this.store.loadOpCausalHistoryByHash(hash);
            if (opHistory !== undefined) {
                this.start.add(opHistory);
                this.fragment.remove(opHistory.causalHistoryHash);
            }
        }

        for (const hash of targetOpHistories) {
            if (!this.start.contents.has(hash)) {
                const opHistory = await this.store.loadOpCausalHistoryByHash(hash);
                if (opHistory !== undefined) {
                    this.fragment.add(opHistory)
                }
            }
        }

        this.updateGap();

        while (this.gap.size > 0 && this.fragment.contents.size < maxDeltaSize) {

            let h: number | undefined = undefined;

            for (const hash of this.fragment.getStartingOpHistories()) {

                const op = this.fragment.contents.get(hash) as OpCausalHistory;
                if (h === undefined || op._computedProps?.height as number < h) {
                    h = op._computedProps?.height;
                }
            }

            for (const hash of Array.from(this.start.missingPrevOpHistories)) {

                if (this.start.contents.size >= maxBacktrackSize) {
                    break;
                }

                const op = await this.store.loadOpCausalHistoryByHash(hash);
                if (op !== undefined && (op._computedProps?.height as number) > (h as number)) {
                    this.start.add(op);
                    this.fragment.remove(hash);
                }
            }

            for (const hash of Array.from(this.fragment.missingPrevOpHistories)) {

                if (this.fragment.contents.size >= maxDeltaSize) {
                    break;
                }

                if (!this.start.contents.has(hash)) {
                    const op = await this.store.loadOpCausalHistoryByHash(hash);

                    if (op !== undefined) {
                        this.fragment.add(op);
                    }
                }
            }

            this.updateGap();

        }

    }

    opHistoriesFollowingFromStart(maxOps?: number): Hash[] {

        const start = new Set<Hash>(this.start.contents.keys());

        return this.fragment.causalClosure(start, maxOps);
    }

    private updateGap() {

        const gap = new Set<Hash>();

        for (const hash of this.fragment.missingPrevOpHistories) {
            if (!this.start.contents.has(hash)) {
                gap.add(hash);
            }
        }

        this.gap = gap;

    }

}

export { CausalHistoryDelta };