import { HashReference } from 'data/model/HashReference';
import { MutationOp } from 'data/model/MutationOp';
import { Hash, Hashing } from '../model/Hashing';

type OpCausalHistoryLiteral = {
    opHash: Hash,
    causalHistoryHash: Hash,
    prevOpHashes: Hash[]
};

class OpCausalHistory {
    hash: Hash;
    causalHistoryHash: Hash;

    prevOpHashes: Set<Hash>;

    constructor(opOrLiteral: MutationOp | OpCausalHistoryLiteral) {
        if (opOrLiteral instanceof MutationOp) {
            const op = opOrLiteral as MutationOp;

            this.hash = op.hash();

            if (op._causalHistoryHash === undefined) {
                throw new Error('Trying to get OpCausalHistory from op ' + this.hash + ', but it has not been completed yet. Persist the op to a store first.');
            }

            this.causalHistoryHash = op._causalHistoryHash;

            this.prevOpHashes = new Set(Array.from((op.getPrevOps())).map((ref: HashReference<MutationOp>) => ref.hash));

        } else {

            const literal = opOrLiteral as OpCausalHistoryLiteral;

            this.hash = literal.opHash;
            this.causalHistoryHash = literal.causalHistoryHash;
            this.prevOpHashes = new Set(literal.prevOpHashes);

        }
    }

    verify(prevOpCausalHistories: Map<Hash, OpCausalHistory | Hash>): boolean {
        return this.causalHistoryHash === OpCausalHistory.computeCausalHistoryHash(prevOpCausalHistories);
    }

    static computeCausalHistoryHash(prevOpCausalHistories: Map<Hash, Hash|OpCausalHistory>): Hash {

        const sortedPrevOpHashes = Array.from(prevOpCausalHistories.keys());
        sortedPrevOpHashes.sort();

        const causalHistoryHashes: Hash[] = [];

        for (const prevOpHash of sortedPrevOpHashes) {

            const prevOpCausalHistory = prevOpCausalHistories.get(prevOpHash);

            if (prevOpCausalHistory === undefined) {
                throw new Error('Cannot compute causal history hash due to missing causal history for previous op ' + prevOpHash);
            }

            if (! ( typeof(prevOpCausalHistory) === 'string' || 
                    (prevOpCausalHistory instanceof OpCausalHistory && 
                        prevOpCausalHistory.hash === prevOpHash &&
                        prevOpCausalHistory.causalHistoryHash !== undefined)
                  )
                ) {

                throw new Error('Cannot compute causal history hash due to invalid causal history for previous op ' + prevOpHash);
            }

            causalHistoryHashes.push(prevOpHash);
            if (typeof(prevOpCausalHistory) === 'string') {
                causalHistoryHashes.push(prevOpCausalHistory);
            } else {
                causalHistoryHashes.push(prevOpCausalHistory.causalHistoryHash);
            }

        }

        return Hashing.forValue(causalHistoryHashes);

    }
}

export { OpCausalHistory };