import { HashReference } from 'data/model/HashReference';
import { MutationOp } from 'data/model/MutationOp';
import { Hash, Hashing } from '../model/Hashing';

type OpCausalHistoryLiteral = {
    causalHistoryHash: Hash;
    opHash: Hash;
    opProps?: any,
    prevOpHashes: Hash[]
};

type OpCausalHistoryProps = Map<string, number|string|BigInt>;

class OpCausalHistory {
    causalHistoryHash: Hash;
    opHash: Hash;
    opProps: OpCausalHistoryProps;
    prevOpHashes: Set<Hash>;
    
    _computedProps?: { height: number, size: number };

    constructor(opOrLiteral: MutationOp | OpCausalHistoryLiteral, prevOpCausalHistories?: Map<Hash, OpCausalHistory|Hash>) {
        if (opOrLiteral instanceof MutationOp) {
            const op = opOrLiteral as MutationOp;

            if (prevOpCausalHistories === undefined) {
                throw new Error('Parameter prevOpCausalHistories is mandatory to create an OpCausalHistory from a MutationOp');
            }

            this.opHash = op.hash();
            this.prevOpHashes = new Set(Array.from((op.getPrevOps())).map((ref: HashReference<MutationOp>) => ref.hash));
            this.opProps = op.getCausalHistoryProps();

            this.causalHistoryHash = OpCausalHistory.computeCausalHistoryHash(this.opHash, this.opProps, prevOpCausalHistories);


        } else {

            const literal = opOrLiteral as OpCausalHistoryLiteral;

            OpCausalHistory.checkLiteralFormat(literal);
            
            this.causalHistoryHash = literal.causalHistoryHash;
            this.opHash = literal.opHash;
            this.prevOpHashes = new Set(literal.prevOpHashes);
            this.opProps = new Map();

            if (literal.opProps !== undefined) {
                for (const key of Object.keys(literal.opProps)) {
                    this.opProps.set(key, literal.opProps[key]);
                }
            }


        }
    }

    verify(prevOpCausalHistories: Map<Hash, OpCausalHistory | Hash>): boolean {
        return this.causalHistoryHash === this.hash(prevOpCausalHistories);
    }

    hash(prevOpCausalHistories: Map<Hash, Hash|OpCausalHistory>): Hash {
        return OpCausalHistory.computeCausalHistoryHash(this.opHash, this.opProps, prevOpCausalHistories)
    }

    literalize(): OpCausalHistoryLiteral {



        const literal: OpCausalHistoryLiteral = { 
            causalHistoryHash: this.causalHistoryHash,
            opHash: this.opHash,
            prevOpHashes: Array.from(this.prevOpHashes)
        };

        if (this.opProps.size > 0) {
            literal.opProps = {};

            for (const [key, val] of this.opProps.entries()) {
                literal.opProps[key] = val;
            }
        }

        return literal;
    }

    static computeCausalHistoryHash(opHash: Hash, opProps: OpCausalHistoryProps, prevOpCausalHistories: Map<Hash, Hash|OpCausalHistory>): Hash {

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
                        prevOpCausalHistory.opHash === prevOpHash)
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

        const p: any = {};
        for (const propName of Object.keys(opProps)) {
            p[propName] = opProps.get(propName);
        }

        return Hashing.forValue({hash: opHash, history: causalHistoryHashes, props: p});
    }

    static computeProps(prevOpCausalHistories: Map<Hash, Hash|OpCausalHistory>): {height: number, size: number} | undefined {
    
        let height = 1;
        let size = 1;
        let good = true;

        for (const prevOpHistory of prevOpCausalHistories.values()) {
            if (prevOpHistory instanceof OpCausalHistory && prevOpHistory._computedProps !== undefined) {
                if (prevOpHistory._computedProps.height + 1 > height) {
                    height = prevOpHistory._computedProps.height + 1;
                }

                size = size + prevOpHistory._computedProps.size;
            } else {
                good = false;
                break;
            }
        }

        if (good) {
            return { height: height, size: size };
        } else {
            return undefined;
        }

    }

    private static checkLiteralFormat(literal: OpCausalHistoryLiteral): void {
        const propTypes: any = {causalHistoryHash: 'string', opHash: 'string', prevOpHashes: 'object' };
        
        for (const propName of ['causalHistoryHash', 'opHash', 'prevOpHashes']) {
            
            const prop = (literal as any)[propName];
            
            if (prop === undefined) {
                throw new Error('OpCausalHistory literal is missing property: ' + propName);
            }

            if (typeof(prop) !== propTypes[propName]) {
                throw new Error('OpCausalHistory literal property ' + propName + ' has the wrong type, expected ' + propTypes[propName] + ' but found ' + typeof(prop));
            }
        }


        if (!Array.isArray(literal.prevOpHashes)) {
            throw new Error('OpCausalHistory prevOpHashes should be an array');
        }

        for (const hash of literal.prevOpHashes) {
            if (typeof(hash) !== 'string') {
                throw new Error('OpCausalHistory prevOpHashes should contain only strings, found ' + typeof(hash) + ' instead');
            }
        }

        if (literal.opProps !== undefined) {

            if (typeof(literal.opProps) !== 'object') {
                throw new Error('OpCausalHistory literal property opProps has the wrong type, expected object but found ' + typeof(literal.opProps));
            }

            const keys = Object.keys(literal.opProps);

            if (keys.length === 0) {
                throw new Error('OpCausalHistory literal property opProps is empty, it should either be missing altogether or be non-empty.');
            }

            const customPropTypes = ['string', 'number', 'bigint'];
            for (const customPropName of Object.keys(literal.opProps)) {
                if (customPropTypes.indexOf(typeof(literal.opProps[customPropName])) < 0) {
                    throw new Error('Unexpected type found in OpCausalHistory literal opProps: ' + typeof(literal.opProps[customPropName] + ' (expected string, number of bigint)'));
                }
            }
        }

        
    }
}

export { OpCausalHistory, OpCausalHistoryLiteral, OpCausalHistoryProps };