import { MultiMap } from 'util/multimap';
import { Timestamps } from 'util/timestamps';

import { Identity } from '../../identity';
import { Hash, HashedObject, MutableObject, MutationOp, MutableContentEvents, ClassRegistry } from '../../model';

import { Authorizer } from '../../model/causal/Authorization';
import { Verification } from '../../model/causal/Authorization';

import { AuthError, BaseCausalCollection, CausalCollectionConfig } from './CausalCollection';
import { isLiteralContext } from 'data/model/literals/Context';


type UpdateSig = {
    opHash: Hash,
    sequence: number,
    timestamp: string
};

function sig(op: CausalRefUpdateOp<any>) {
    return {opHash: op.getLastHash(), sequence: op.sequence as number, timestamp: op.timestamp as string};
}

// We want an array with the "latest" update (by causality, then timestmap, then hash) at the end

// the following should return -1 if u2 comes after u1;

function compareUpdateSigs(u1: UpdateSig, u2: UpdateSig) {

    if (u2.sequence > u1.sequence) {
        return -1;
    } else if (u1.sequence > u2.sequence) {
        return 1;
    } else { // u2.sequence === u1.sequence
        if (Timestamps.after(u2.timestamp, u1.timestamp)) {
            return -1;
        } else if (Timestamps.after(u1.timestamp, u2.timestamp)) {
            return 1;
        } else { // u2.timestamp === u1.timestamp
            return u1.opHash.localeCompare(u2.opHash);
        }
    }
}

class CausalReference<T> extends BaseCausalCollection<T>  {

    static className = 'hhs/v0/CausalReference';

    // all the applied update ops, the latest that is valid is the current value.
    _causallyOrderedUpdates: Array<UpdateSig>;

    _latestValidIdx?: number; // <- we cache the idx of the latest valid op in the array,
    _value?: T;               // <- and its value, if any.

    _largestSequence?: number;

    constructor(config?: CausalCollectionConfig) {
        super([CausalRefUpdateOp.className], {...config, supportsUndo: true, supportsCheckpoints: true});

        this.setRandomId();

        this._causallyOrderedUpdates = [];
    }

    getValue() : T|undefined {
        return this._value;
    }

    async setValue(value: T, author?: Identity): Promise<void> {

        if (!(value instanceof HashedObject) && !HashedObject.isLiteral(value)) {
            throw new Error('CausalReferences can contain either a class deriving from HashedObject or a pure literal (a constant, without any HashedObjects within).');
        }

        if (!this.shouldAcceptElement(value)) {
            throw new Error('CausalReference has type/element contraints that reject the element that is being added:' + value)
        }

        const nextSeq = this._largestSequence === undefined? 0 : this._largestSequence + 1;

        let op = new CausalRefUpdateOp<T>(this, value, nextSeq, author);

        const auth = this.createUpdateAuthorizer(author);

        this.setCurrentPrevOpsTo(op);

        if (!(await auth.attempt(op))) {
            throw new AuthError('Cannot authorize addition operation on CausalReference ' + this.hash() + ', author is: ' + author?.hash());
        }

        return this.applyNewOp(op);
    }
    
    exportMutableState() {
        return {
            _causallyOrderedUpdates: this._causallyOrderedUpdates,
            _latestValidIdx: this._latestValidIdx,
            _value: this._value instanceof HashedObject? this._value?.toLiteralContext() : this._value,
            _largestSequence: this._largestSequence
        };
    }
    
    importMutableState(state: any) {
        this._value = isLiteralContext(state._value) ? HashedObject.fromLiteralContext(state._value) : state._value;
        this._causallyOrderedUpdates = state._causallyOrderedUpdates;
        this._latestValidIdx = state._latestValidIdx;
        this._largestSequence = state._largestSequence;
    }

    protected createUpdateAuthorizer(author?: Identity): Authorizer {
        return this.createWriteAuthorizer(author);
    }

    async canSetValue(_value?: T, author?: Identity): Promise<boolean> {
        return this.createUpdateAuthorizer(author).attempt();
    }

    async mutate(op: MutationOp, valid: boolean): Promise<boolean> {
        let refUpdateOp = op as CausalRefUpdateOp<T>;


        let mutated = false;

        if (op instanceof CausalRefUpdateOp) {

            //console.log('processing sequence ' + op.sequence + ', valid=' + valid)

            const up = sig(op);

            let idx: number; // the position of op in the array

            // find the right place for the op in the array:
            const length = this._causallyOrderedUpdates.length
            idx = length;

            while (idx>0 && compareUpdateSigs(this._causallyOrderedUpdates[idx-1], up) > 0) {
                idx=idx-1;
            }

            // and then insert it there, if it was not there already:

            // NOTE: since the compare above failed, upds[idx-1] <= up
            if (idx===0 || this._causallyOrderedUpdates[idx-1].opHash !== up.opHash) {
                // upds[idx-1] < up => insert in position idx
                this._causallyOrderedUpdates.splice(idx, 0, up);
            } else {
                // upds[idx-1] === up => use old position idx-1
                idx = idx-1;
            }
            
            let newValueIdx: number|undefined;
            let newValueOp: CausalRefUpdateOp<T>|undefined;

            let unsetValue = false; // to indicate that there are no valid ops left,
                                    // and that the value should be set back to undefined

            if (valid) {
                if (this._latestValidIdx === undefined || idx > this._latestValidIdx) {
                    // we need to set a new value!
                    newValueIdx = idx;
                    newValueOp = op;
                }
            } else {
                if (this._latestValidIdx === idx) {
                    // the current value has been invalidated, look for the next-best

                    let nextValueIdx = length-1;

                    while (nextValueIdx>=0 && !this.isValidOp(this._causallyOrderedUpdates[nextValueIdx].opHash)) {
                        nextValueIdx=nextValueIdx-1;
                    }

                    if (nextValueIdx >= 0) {

                        newValueIdx = nextValueIdx;
                        newValueOp  = await this.loadOp(this._causallyOrderedUpdates[nextValueIdx].opHash) as CausalRefUpdateOp<T>;
                    } else {
                        if (this._value !== undefined) {
                            unsetValue = true;
                        }
                    }
                }
            }

            mutated = unsetValue || newValueIdx !== undefined;

            const oldValue = this._value;

            if (unsetValue) {
                this._latestValidIdx  = undefined;
                this._value           = undefined;
                this._largestSequence = undefined;
            } else if (newValueIdx !== undefined) {
                this._latestValidIdx  = newValueIdx;
                this._value           = newValueOp?.value;
                this._largestSequence = newValueOp?.sequence;
            }

            if (mutated) {
                this._mutationEventSource?.emit({emitter: this, action: 'update', data: refUpdateOp.getValue()});
                
                if (oldValue !== this._value) {
                    if (oldValue instanceof HashedObject) {
                        this._mutationEventSource?.emit({emitter: this, action: MutableContentEvents.RemoveObject, data: oldValue});
                    }
                    if (this._value instanceof HashedObject) {
                        this._mutationEventSource?.emit({emitter: this, action: MutableContentEvents.AddObject, data: this._value});
                    }
                }
            }
            
        }

        return Promise.resolve(mutated);
    }

    getMutableContents(): MultiMap<Hash, HashedObject> {
        const contents = new MultiMap<Hash, HashedObject>();

        if (this._value instanceof HashedObject) {
            contents.add(this._value.hash(), this._value);
        }

        return contents;
    }
    
    getMutableContentByHash(hash: Hash): Set<HashedObject> {
        
        const found = new Set<HashedObject>();
        
        if (this._value instanceof HashedObject && this._value.hash() === hash) {
            found.add(this._value);
        }

        return found;
    }

    getClassName(): string {
        return CausalReference.className;
    }
    
    init(): void {
        
    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!(await super.validate(references))) {
            return false;
        }

        return true;
    }

    shouldAcceptMutationOp(op: MutationOp, opReferences: Map<Hash, HashedObject>): boolean {

        if (!super.shouldAcceptMutationOp(op, opReferences)) {
            return false;
        }

        if (op instanceof CausalRefUpdateOp) {

            if (!this.shouldAcceptElement(op.value as T)) {
                return false;
            }
            
            const author = op.getAuthor();

            const auth = this.createUpdateAuthorizer(author);
                                                                                
            const usedKeys     = new Set<string>();

            if (!auth.verify(op, usedKeys)) {
                return false;
            }

            if (!Verification.checkKeys(usedKeys, op)) {
                return false;
            }

        }

        return true;
    }
}

class CausalRefUpdateOp<T> extends MutationOp {

    static className = 'hhs/v0/CausalRefUpdateOp';

    sequence?: number;
    timestamp?: string;
    value?: T;


    constructor(targetObject?: CausalReference<T>, value?: T, sequence?: number, author?: Identity) {
        super(targetObject);

        if (targetObject !== undefined) {
            this.value = value;
            this.sequence = sequence;
            this.timestamp = Timestamps.uniqueTimestamp();
            
            if (author !== undefined) {
                this.setAuthor(author);
            }
        }
        
    }

    getClassName(): string {
        return CausalRefUpdateOp.className;
    }

    init(): void {

    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }

        const targetObject = this.getTargetObject();

        if (!(targetObject instanceof CausalReference)) {
            return false;
        }

        if (this.sequence === undefined) {
            MutableObject.validationLog.debug('The field sequence is mandatory in class RefUpdateOp');
            return false;
        }

        if ((typeof this.sequence) !== 'number') {
            MutableObject.validationLog.debug('The field sequence should be of type number in class RefUpdateop');
            return false;
        }

        if (this.timestamp === undefined) {
            MutableObject.validationLog.debug('The field timestamp is mandatory in class RefUpdateOp');
            return false;
        }

        if ((typeof this.timestamp) !== 'string') {
            MutableObject.validationLog.debug('The field timestamp should be of type timestamp in class RefUpdateop');
            return false;
        }

        if (this.value === undefined) {
            MutableObject.validationLog.debug('The field value is mandatory in class REfUpdateop');
            return false;
        }

        if (targetObject.acceptedElementHashes !== undefined && !targetObject.acceptedElementHashes.has(HashedObject.hashElement(this.value))) {
            return false;
        }

        if (targetObject.acceptedTypes !== undefined && 
              !(
                (this.value instanceof HashedObject && targetObject.acceptedTypes.has(this.value.getClassName())) 
                        ||
                (!(this.value instanceof HashedObject) && targetObject.acceptedTypes.has(typeof(this.value)))
               )
                
        ) {

            return false;

        }

        return true;
    }

    getSequence() {
        return this.sequence as number;
    }

    getTimestamp() {
        return this.timestamp as string;
    }

    getValue() {
        return this.value as T;
    }
}

ClassRegistry.register(CausalReference.className, CausalReference);
ClassRegistry.register(CausalRefUpdateOp.className, CausalRefUpdateOp);

export { CausalReference };