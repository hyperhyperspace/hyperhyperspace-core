import { Hash } from 'data/model/Hashing';
import { Store } from 'storage/store';
import { CausalHistoryFragment } from './CausalHistoryFragment';
import { OpCausalHistory } from './OpCausalHistory';


class CausalHistoryDelta {

    static async compute(mutableObj: Hash, targetOpHistories: Array<Hash>, startingOpHistories: Array<Hash>, store: Store, maxDeltaSize: number, maxBacktrackSize: number) {

        const start = new CausalHistoryFragment(mutableObj);

        for (const hash of startingOpHistories) {
            const opHistory = await store.loadOpCausalHistoryByHash(hash);
            if (opHistory !== undefined) {
                start.add(opHistory);
            }
        }

        const delta = new CausalHistoryFragment(mutableObj);

        for (const hash of targetOpHistories) {
            if (!start.contents.has(hash)) {
                const opHistory = await store.loadOpCausalHistoryByHash(hash);
                if (opHistory !== undefined) {
                    delta.add(opHistory)
                }
            }
        }

        let gap = CausalHistoryDelta.computeGap(delta, start);

        while (gap.size > 0 && delta.contents.size < maxDeltaSize) {

            let h: number | undefined = undefined;

            for (const hash of delta.getStartingOpHistories()) {

                const op = delta.contents.get(hash) as OpCausalHistory;
                if (h === undefined || op._computedProps?.height as number < h) {
                    h = op._computedProps?.height;
                }
            }

            for (const hash of Array.from(start.missingPrevOpHistories)) {

                if (start.contents.size >= maxBacktrackSize) {
                    break;
                }

                const op = await store.loadOpCausalHistoryByHash(hash);
                if (op !== undefined && (op._computedProps?.height as number) > (h as number)) {
                    start.add(op);
                    delta.remove(hash);
                }
            }

            for (const hash of Array.from(delta.missingPrevOpHistories)) {

                if (delta.contents.size >= maxDeltaSize) {
                    break;
                }

                if (!start.contents.has(hash)) {
                    const op = await store.loadOpCausalHistoryByHash(hash);

                    if (op !== undefined) {
                        delta.add(op);
                    }
                }
            }

            gap = CausalHistoryDelta.computeGap(delta, start);

        }

        return delta;

    }

    private static computeGap(current: CausalHistoryFragment, backtrack: CausalHistoryFragment) {

        const gap = new Set<Hash>();

        for (const hash of current.missingPrevOpHistories) {
            if (!backtrack.contents.has(hash)) {
                gap.add(hash);
            }
        }

        return gap;

    }

}

export { CausalHistoryDelta };