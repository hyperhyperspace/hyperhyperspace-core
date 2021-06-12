import { HashedMap } from 'data/model/HashedMap';
import { HashedSet } from 'data/model/HashedSet';
import { HashReference } from 'data/model/HashReference';
import { MutationOp } from 'data/model/MutationOp';
import { Hash, Hashing } from '../model/Hashing';

type OpCausalHistoryLiteral = {
    causalHistoryHash: Hash,
    opHash: Hash,
    opProps?: any,
    prevOpHistories: Hash[],
    computedHeight: number,
    computedSize: number
};

type OpCausalHistoryProps = Map<string, number|string>;

class OpCausalHistory {
    causalHistoryHash: Hash;
    opHash: Hash;
    opProps: OpCausalHistoryProps;
    prevOpHistories: Set<Hash>;
    computedProps: { height: number, size: number };

    constructor(opOrLiteral: MutationOp | OpCausalHistoryLiteral, prevOpCausalHistories?: Map<Hash, OpCausalHistory>) {
        
        if (opOrLiteral instanceof MutationOp) {
            const op = opOrLiteral as MutationOp;

            this.opHash = op.hash();

            if (prevOpCausalHistories === undefined) {
                throw new Error('Parameter prevOpCausalHistories is mandatory to create an OpCausalHistory from a MutationOp');
            }
            
            this.prevOpHistories = new Set();
            for (const prevOpRef of op.prevOps?.values() as IterableIterator<HashReference<MutationOp>>) {
                const history = prevOpCausalHistories.get(prevOpRef.hash);

                if (history === undefined) {
                    throw new Error('Cannot create causal history for op ' + op.hash() + ', causal history for prevOp ' + prevOpRef.hash + ' is missing.');
                }

                const prevOpHistory = history instanceof OpCausalHistory? history.causalHistoryHash : history;

                this.prevOpHistories.add(prevOpHistory);
            } 

            this.opProps = op.getCausalHistoryProps(prevOpCausalHistories);

            if (prevOpCausalHistories === undefined) {
                throw new Error('Cannot create OpCausalHistory for op, prevOpCausalHistories is missing.');
            } else {
                this.computedProps = OpCausalHistory.computeProps(prevOpCausalHistories);
            }

            this.causalHistoryHash = this.hash();

        } else {

            const literal = opOrLiteral as OpCausalHistoryLiteral;

            OpCausalHistory.checkLiteralFormat(literal);
            
            this.causalHistoryHash = literal.causalHistoryHash;
            this.opHash = literal.opHash;
            this.prevOpHistories = new Set(literal.prevOpHistories);
            this.opProps = new Map();

            if (literal.opProps !== undefined) {
                for (const key of Object.keys(literal.opProps)) {
                    this.opProps.set(key, literal.opProps[key]);
                }
            }

            this.computedProps = { height: literal.computedHeight, size: literal.computedSize };

            if (this.hash() !== literal.causalHistoryHash) {
                throw new Error('Received OpCausalHistory literal has wrong hash');
            }
        }

        
    }

    verifyOpMatch(op: MutationOp, prevOpCausalHistories: Map<Hash, OpCausalHistory>): boolean {

        if (op.hash() !== this.opHash) {
            return false;
        }

        const receivedProps = new HashedMap<string, string|number|bigint>();
        for (const [propName, propVal] of op.getCausalHistoryProps(prevOpCausalHistories).entries()) {
            receivedProps.set(propName, propVal);
        }

        const expectedProps = new HashedMap<string, string|number|bigint>();
        for (const [propName, propVal] of this.opProps.entries()) {
            expectedProps.set(propName, propVal);
        }

        if (!receivedProps.equals(expectedProps)) {
            return false;
        }

        const receivedHistories = new HashedSet<Hash>()
        for (const prevOpRef of op.getPrevOps()) {
            const prevOpHistory = prevOpCausalHistories.get(prevOpRef.hash);
            if (prevOpHistory === undefined) {
                return false;
            }
            receivedHistories.add(prevOpHistory.causalHistoryHash);
        }

        const expectedHistories = new HashedSet<Hash>(this.prevOpHistories.values());

        if (!receivedHistories.equals(expectedHistories)) {
            return false;
        }

        const computed = OpCausalHistory.computeProps(prevOpCausalHistories);

        if (computed.size !== this.computedProps.size || computed.height !== this.computedProps.height) {
            return false;
        }

        return true;
    }

    hash(): Hash {

        const sortedCausalHistoryHashes = Array.from(this.prevOpHistories.values());
        sortedCausalHistoryHashes.sort();

        const p: any = {};
        for (const propName of Object.keys(this.opProps)) {
            p[propName] = this.opProps.get(propName);
        }

        return Hashing.forValue({opHash: this.opHash, history: sortedCausalHistoryHashes, props: p, computedProps: this.computedProps});
    }

    literalize(): OpCausalHistoryLiteral {

        const literal: OpCausalHistoryLiteral = { 
            causalHistoryHash: this.causalHistoryHash,
            opHash: this.opHash,
            prevOpHistories: Array.from(this.prevOpHistories),
            computedHeight: this.computedProps.height,
            computedSize: this.computedProps.size
        };

        if (this.opProps.size > 0) {
            literal.opProps = {};

            for (const [key, val] of this.opProps.entries()) {
                literal.opProps[key] = val;
            }
        }

        return literal;
    }

    private static computeProps(prevOpCausalHistories: Map<Hash, OpCausalHistory>): {height: number, size: number} {
    
        let height = 1;
        let size = 1;

        for (const prevOpHistory of prevOpCausalHistories.values()) {
            if (prevOpHistory instanceof OpCausalHistory && prevOpHistory.computedProps !== undefined) {
                if (prevOpHistory.computedProps.height + 1 > height) {
                    height = prevOpHistory.computedProps.height + 1;
                }

                size = size + prevOpHistory.computedProps.size;
            } else {
                throw new Error('Missing prevOpCausalHistories, cannot create OpCausalHistory object.')
            }
        }

        return { height: height, size: size };
    }

    private static checkLiteralFormat(literal: OpCausalHistoryLiteral): void {
        const propTypes: any = {causalHistoryHash: 'string', opHash: 'string', prevOpHistories: 'object', computedHeight: 'number', computedSize: 'number' };
        
        for (const propName of ['causalHistoryHash', 'opHash', 'prevOpHistories']) {
            
            const prop = (literal as any)[propName];
            
            if (prop === undefined) {
                throw new Error('OpCausalHistory literal is missing property: ' + propName);
            }

            if (typeof(prop) !== propTypes[propName]) {
                throw new Error('OpCausalHistory literal property ' + propName + ' has the wrong type, expected ' + propTypes[propName] + ' but found ' + typeof(prop));
            }
        }


        if (!Array.isArray(literal.prevOpHistories)) {
            throw new Error('OpCausalHistory prevOpHistories should be an array');
        }

        for (const hash of literal.prevOpHistories) {
            if (typeof(hash) !== 'string') {
                throw new Error('OpCausalHistory prevOpHistories should contain only strings, found ' + typeof(hash) + ' instead');
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

            const customPropTypes = ['string', 'number'];
            for (const customPropName of Object.keys(literal.opProps)) {
                if (customPropTypes.indexOf(typeof(literal.opProps[customPropName])) < 0) {
                    throw new Error('Unexpected type found in OpCausalHistory literal opProps: ' + typeof(literal.opProps[customPropName] + ' (expected string, number of bigint)'));
                }
            }
        }

        if (Object.keys(literal).length !== Object.keys(propTypes).length + (literal.opProps === undefined? 0 : 1)) {
            throw new Error('OpCausalHistory literal has more properties than it should')
        }
    }
}

export { OpCausalHistory, OpCausalHistoryLiteral, OpCausalHistoryProps };