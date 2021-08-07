import { Hash } from 'data/model/Hashing';
import { Store } from 'storage/store';
import { HistoryFragment } from './HistoryFragment';
import { OpHeader } from './OpHeader';


class HistoryDelta {

    mutableObj: Hash;

    store: Store;

    fragment: HistoryFragment;
    start: HistoryFragment;

    gap: Set<Hash>;

    constructor(mutableObj: Hash, store: Store) {

        this.mutableObj = mutableObj;
        this.store = store;

        this.fragment = new HistoryFragment(mutableObj);
        this.start = new HistoryFragment(mutableObj);

        this.gap = new Set<Hash>();
    }

    async compute(targetOpHeaders: Array<Hash>, startingOpHeaders: Array<Hash>, maxDeltaSize: number, maxBacktrackSize: number) {

        for (const hash of startingOpHeaders) {
            const opHeader = await this.store.loadOpHeaderByHeaderHash(hash);
            if (opHeader !== undefined) {
                this.start.add(opHeader);
                this.fragment.remove(opHeader.headerHash);
            }
        }

        for (const hash of targetOpHeaders) {
            if (!this.start.contents.has(hash)) {
                const opHeader = await this.store.loadOpHeaderByHeaderHash(hash);
                if (opHeader !== undefined) {
                    this.fragment.add(opHeader)
                }
            }
        }

        this.updateGap();

        while (this.gap.size > 0 && this.fragment.contents.size < maxDeltaSize) {

            let h: number | undefined = undefined;

            for (const hash of this.fragment.getStartingOpHeaders()) {

                const op = this.fragment.contents.get(hash) as OpHeader;
                if (h === undefined || op.computedProps?.height as number < h) {
                    h = op.computedProps?.height;
                }
            }

            for (const hash of Array.from(this.start.missingPrevOpHeaders)) {

                if (this.start.contents.size >= maxBacktrackSize) {
                    break;
                }

                const op = await this.store.loadOpHeaderByHeaderHash(hash);
                if (op !== undefined && (op.computedProps?.height as number) > (h as number)) {
                    this.start.add(op);
                    this.fragment.remove(hash);
                }
            }

            for (const hash of Array.from(this.fragment.missingPrevOpHeaders)) {

                if (this.fragment.contents.size >= maxDeltaSize) {
                    break;
                }

                if (!this.start.contents.has(hash)) {
                    const op = await this.store.loadOpHeaderByHeaderHash(hash);

                    if (op !== undefined) {
                        this.fragment.add(op);
                    }
                }
            }

            this.updateGap();

        }

    }

    opHeadersFollowingFromStart(maxOps?: number): Hash[] {

        const start = new Set<Hash>(this.start.contents.keys());

        return this.fragment.causalClosure(start, maxOps);
    }

    private updateGap() {

        const gap = new Set<Hash>();

        for (const hash of this.fragment.missingPrevOpHeaders) {
            if (!this.start.contents.has(hash)) {
                gap.add(hash);
            }
        }

        this.gap = gap;

    }

}

export { HistoryDelta };