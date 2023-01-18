import { MutableContentEvents, MutableObject } from '../../model/mutable/MutableObject';
import { MutationOp } from '../../model/mutable/MutationOp';
import { HashedObject } from '../../model/immutable/HashedObject';
import { Timestamps } from 'util/timestamps';
import { Hash } from '../../model/hashing';
import { ClassRegistry } from '../../model';
import { MultiMap } from 'util/multimap';
import { Identity } from 'data/identity';
import { BaseCollection, CollectionConfig, CollectionOp } from './Collection';

class MutableReference<T> extends BaseCollection<T> {

    static className = 'hhs/v0/MutableReference';

    _sequence?: number;
    _timestamp?: string;
    _value?: T;

    constructor(config?: CollectionConfig) {
        super([RefUpdateOp.className], {supportsCheckpoints: true, ...config});
        
        this.setRandomId();
    }

    getValue() : T | undefined {
        return this._value;
    }

    setValue(value: T, author?: Identity) {

        if (!(value instanceof HashedObject)) {
            if (!HashedObject.isLiteral(value)) {
                throw new Error('MutableReferences can contain either a class deriving from HashedObject or a pure literal (a constant, without any HashedObjects within).');
            }
        }

        let op = new RefUpdateOp<T>(this, value, this._sequence, author);
        return this.applyNewOp(op);
    }

    mutate(op: MutationOp): Promise<boolean> {
        let refUpdateOp = op as RefUpdateOp<T>;

        let mutated = false;
        if (refUpdateOp.getTargetObject().equals(this)) {
            if (this._sequence === undefined || 
                this._sequence < refUpdateOp.getSequence() ||
                (this._sequence === refUpdateOp.getSequence() && 
                 Timestamps.after(refUpdateOp.getTimestamp(), this._timestamp as string))) {


                 const oldVal = this._value;

                 this._sequence = refUpdateOp.getSequence();
                 this._timestamp = refUpdateOp.getTimestamp();
                 this._value = refUpdateOp.getValue();                    

                 mutated = true;

                 this._mutationEventSource?.emit({emitter: this, action: 'update', data: refUpdateOp.getValue()});

                if (oldVal !== this._value) {
                    if (oldVal instanceof HashedObject) {
                        this._mutationEventSource?.emit({emitter: this, action: MutableContentEvents.RemoveObject, data: oldVal});
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
        return MutableReference.className;
    }
    
    init(): void {
        
    }
    
    exportMutableState() {
        return {
            _sequence: this._sequence,
            _timestamp: this._timestamp,
            _value: this._value
        };
    }
    
    importMutableState(state: any) {
        this._sequence = state._sequence;
        this._timestamp = state._timestamp;
        this._value = state._value;
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

        if (op instanceof RefUpdateOp && !this.shouldAcceptElement(op.value as T)) {
            return false;
        }

        return true;
    }
}

class RefUpdateOp<T> extends CollectionOp<T> {

    static className = 'hhs/v0/RefUpdateOp';

    sequence?: number;
    timestamp?: string;
    value?: T;


    constructor(targetObject?: MutableReference<T>, value?: T, sequence?: number, author?: Identity) {
        super(targetObject);

        if (targetObject !== undefined) {
            this.value = value;
            this.sequence = sequence === undefined? 0 : sequence + 1;
            this.timestamp = Timestamps.uniqueTimestamp();
            
            if (author !== undefined) {
                this.setAuthor(author);
            }
        }
        
    }

    getClassName(): string {
        return RefUpdateOp.className;
    }

    init(): void {

    }

    async validate(references: Map<Hash, HashedObject>) {

        if (!await super.validate(references)) {
            return false;
        }

        const targetObject = this.getTargetObject();

        if (!(targetObject instanceof MutableReference)) {
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
            MutableObject.validationLog.debug('The field value is mandatory in class RefUpdateop');
            return false;
        }

        if (!(this.value instanceof HashedObject)) {
            if (!HashedObject.isLiteral(this.value)) {
                MutableObject.validationLog.debug('The field value in class RefUpdateop must either be a HashedObject instance or a pure literal (a constant, without any HashedObjects within).');
                return false;
            }
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

ClassRegistry.register(MutableReference.className, MutableReference);
ClassRegistry.register(RefUpdateOp.className, RefUpdateOp);

export { MutableReference, RefUpdateOp };