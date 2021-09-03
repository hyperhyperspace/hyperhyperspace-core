import { HashedMap } from 'data/model/HashedMap';
import { HashedSet } from 'data/model/HashedSet';
import { HashReference } from 'data/model/HashReference';
import { MutationOp } from 'data/model/MutationOp';
import { Hash, Hashing } from '../model/Hashing';

type OpHeaderLiteral = {
    headerHash: Hash,
    headerProps?: any,
    opHash: Hash,
    prevOpHeaders: Hash[],
    computedHeight: number,
    computedSize: number
};

type OpHeaderProps = Map<string, number|string>;

class OpHeader {
    headerHash: Hash;
    headerProps: OpHeaderProps;
    
    opHash: Hash;
    prevOpHeaders: Set<Hash>;
    computedProps: { height: number, size: number };

    constructor(opOrLiteral: MutationOp | OpHeaderLiteral, prevOpHeaders?: Map<Hash, OpHeader>) {
        
        if (opOrLiteral instanceof MutationOp) {
            const op = opOrLiteral as MutationOp;

            this.opHash = op.hash();

            if (prevOpHeaders === undefined) {
                throw new Error('Parameter prevOpCausalHistories is mandatory to create an OpCausalHistory from a MutationOp');
            }

            if (op.prevOps === undefined) {
                throw new Error('Operation has no prevOps (they are undefined)');
            }
            
            this.prevOpHeaders = new Set();
            for (const prevOpRef of op.prevOps?.values() as IterableIterator<HashReference<MutationOp>>) {
                const opHeader = prevOpHeaders.get(prevOpRef.hash);

                if (opHeader === undefined) {
                    throw new Error('Cannot create header for op ' + op.hash() + ', causal history for prevOp ' + prevOpRef.hash + ' is missing.');
                }

                this.prevOpHeaders.add(opHeader.headerHash);
            } 

            this.headerProps = op.getHeaderProps(prevOpHeaders);

            if (prevOpHeaders === undefined) {
                throw new Error('Cannot create OpCausalHistory for op, prevOpCausalHistories is missing.');
            } else {
                this.computedProps = OpHeader.computeProps(prevOpHeaders);
            }

            this.headerHash = this.hash();

        } else {

            const literal = opOrLiteral as OpHeaderLiteral;

            OpHeader.checkLiteralFormat(literal);
            
            this.headerHash = literal.headerHash;
            this.opHash = literal.opHash;
            this.prevOpHeaders = new Set(literal.prevOpHeaders);
            this.headerProps = new Map();

            if (literal.headerProps !== undefined) {
                for (const key of Object.keys(literal.headerProps)) {
                    this.headerProps.set(key, literal.headerProps[key]);
                }
            }

            this.computedProps = { height: literal.computedHeight, size: literal.computedSize };

            if (this.hash() !== literal.headerHash) {
                throw new Error('Received OpCausalHistory literal has wrong hash');
            }
        }

        
    }

    verifyOpMatch(op: MutationOp, prevOpCausalHistories: Map<Hash, OpHeader>): boolean {

        if (op.hash() !== this.opHash) {
            return false;
        }

        const receivedProps = new HashedMap<string, string|number|bigint>();
        for (const [propName, propVal] of op.getHeaderProps(prevOpCausalHistories).entries()) {
            receivedProps.set(propName, propVal);
        }

        const expectedProps = new HashedMap<string, string|number|bigint>();
        for (const [propName, propVal] of this.headerProps.entries()) {
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
            receivedHistories.add(prevOpHistory.headerHash);
        }

        const expectedHistories = new HashedSet<Hash>(this.prevOpHeaders.values());

        if (!receivedHistories.equals(expectedHistories)) {
            return false;
        }

        const computed = OpHeader.computeProps(prevOpCausalHistories);

        if (computed.size !== this.computedProps.size || computed.height !== this.computedProps.height) {
            return false;
        }

        return true;
    }

    hash(): Hash {

        const sortedCausalHistoryHashes = Array.from(this.prevOpHeaders.values());
        sortedCausalHistoryHashes.sort();

        const p: any = {};
        for (const propName of Object.keys(this.headerProps)) {
            p[propName] = this.headerProps.get(propName);
        }

        return Hashing.forValue({opHash: this.opHash, history: sortedCausalHistoryHashes, props: p, computedProps: this.computedProps});
    }

    literalize(): OpHeaderLiteral {

        const literal: OpHeaderLiteral = { 
            headerHash: this.headerHash,
            opHash: this.opHash,
            prevOpHeaders: Array.from(this.prevOpHeaders),
            computedHeight: this.computedProps.height,
            computedSize: this.computedProps.size
        };

        if (this.headerProps.size > 0) {
            literal.headerProps = {};

            for (const [key, val] of this.headerProps.entries()) {
                literal.headerProps[key] = val;
            }
        }

        return literal;
    }

    private static computeProps(prevOpCausalHistories: Map<Hash, OpHeader>): {height: number, size: number} {
    
        let height = 1;
        let size = 1;

        for (const prevOpHistory of prevOpCausalHistories.values()) {
            if (prevOpHistory instanceof OpHeader && prevOpHistory.computedProps !== undefined) {
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

    private static checkLiteralFormat(literal: OpHeaderLiteral): void {
        const propTypes: any = {headerHash: 'string', opHash: 'string', prevOpHeaders: 'object', computedHeight: 'number', computedSize: 'number' };
        
        for (const propName of ['headerHash', 'opHash', 'prevOpHeaders']) {
            
            const prop = (literal as any)[propName];
            
            if (prop === undefined) {
                throw new Error('OpHeader literal is missing property: ' + propName);
            }

            if (typeof(prop) !== propTypes[propName]) {
                throw new Error('OpHeader literal property ' + propName + ' has the wrong type, expected ' + propTypes[propName] + ' but found ' + typeof(prop));
            }
        }


        if (!Array.isArray(literal.prevOpHeaders)) {
            throw new Error('OpHeader prevOpHeaders should be an array');
        }

        for (const hash of literal.prevOpHeaders) {
            if (typeof(hash) !== 'string') {
                throw new Error('OpHeader prevOpHeaders should contain only strings, found ' + typeof(hash) + ' instead');
            }
        }

        if (literal.headerProps !== undefined) {

            if (typeof(literal.headerProps) !== 'object') {
                throw new Error('OpHeader literal property headerProps has the wrong type, expected object but found ' + typeof(literal.headerProps));
            }

            const keys = Object.keys(literal.headerProps);

            if (keys.length === 0) {
                throw new Error('OpCausalHistory literal property opProps is empty, it should either be missing altogether or be non-empty.');
            }

            const customPropTypes = ['string', 'number'];
            for (const customPropName of Object.keys(literal.headerProps)) {
                if (customPropTypes.indexOf(typeof(literal.headerProps[customPropName])) < 0) {
                    throw new Error('Unexpected type found in OpCausalHistory literal opProps: ' + typeof(literal.headerProps[customPropName] + ' (expected string or number)'));
                }
            }
        }

        if (Object.keys(literal).length !== Object.keys(propTypes).length + (literal.headerProps === undefined? 0 : 1)) {
            throw new Error('OpHeader literal has more properties than it should')
        }
    }
}

export { OpHeader, OpHeaderLiteral, OpHeaderProps };