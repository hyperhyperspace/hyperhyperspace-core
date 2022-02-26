import { MutableObject } from '../../model/mutable/MutableObject';
import { MutationOp } from '../../model/mutable/MutationOp';
import { HashedObject } from '../../model/immutable/HashedObject';
import { Timestamps } from 'util/timestamps';
import { Types } from '../Types';
import { Hash } from 'data/model/hashing/Hashing';
import { ClassRegistry } from 'data/model';

class MutableReference<T> extends MutableObject {

    static className = 'hhs/v0/MutableReference';

    typeConstraints?: Array<string>;

    _sequence?: number;
    _timestamp?: string;
    _value?: T;

    constructor() {
        super([RefUpdateOp.className]);

        this.setRandomId();
    }

    getValue() : T | undefined {
        return this._value;
    }

    async setValue(value: T) {
        let op = new RefUpdateOp<T>(this, value, this._sequence);
        await this.applyNewOp(op);
    }

    mutate(op: MutationOp): Promise<boolean> {
        let refUpdateOp = op as RefUpdateOp<T>;

        let mutated = false;
        if (refUpdateOp.getTargetObject().equals(this)) {
            if (this._sequence === undefined || 
                this._sequence < refUpdateOp.getSequence() ||
                (this._sequence === refUpdateOp.getSequence() && 
                 Timestamps.after(refUpdateOp.getTimestamp(), this._timestamp as string))) {

                 this._sequence = refUpdateOp.getSequence();
                 this._timestamp = refUpdateOp.getTimestamp();
                 this._value = refUpdateOp.getValue();                    

                 mutated = true;

                 this._mutationEventSource?.emit({emitter: this, action: 'update', data: refUpdateOp.getValue()});
            }
        }

        return Promise.resolve(mutated);
    }
    
    getClassName(): string {
        return MutableReference.className;
    }
    
    init(): void {
        
    }

    async validate(references: Map<Hash, HashedObject>) {
        references;

        return Types.isTypeConstraint(this.typeConstraints);
    }
    
}

class RefUpdateOp<T> extends MutationOp {

    static className = 'hhs/v0/RefUpdateOp';

    sequence?: number;
    timestamp?: string;
    value?: T;


    constructor(target?: MutableReference<T>, value?: T, sequence?: number) {
        super(target);

        if (target !== undefined) {
            this.value = value;
            this.sequence = sequence === undefined? 0 : sequence + 1;
            this.timestamp = Timestamps.uniqueTimestamp();
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

        if (this.getTargetObject().getAuthor() !== undefined && !(this.getTargetObject().getAuthor()?.equals(this.getAuthor()))) {
            MutableObject.validationLog.debug('RefUpdateOp has author ' + this.getAuthor()?.hash() + ' but points to a target authored by ' + this.getTargetObject().getAuthor()?.hash() + '.');
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

        if (this.targetObject === undefined || 
            this.targetObject.getClassName() !== MutableReference.className ) {
                MutableObject.validationLog.debug('A RefUpdateOp can only have a MutableReference as its target.');
                return false;
        }

        let constraints = (this.targetObject as MutableReference<T>).typeConstraints;

        if (!Types.satisfies(this.value, constraints)) {
            MutableObject.validationLog.debug('RefUpdateOp contains a value with an unexpected type.');
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

ClassRegistry.register(MutableReference.className, MutableReference);
ClassRegistry.register(RefUpdateOp.className, RefUpdateOp);

export { MutableReference };