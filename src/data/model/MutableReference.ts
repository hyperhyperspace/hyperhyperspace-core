import { MutableObject } from './MutableObject';
import { MutationOp } from './MutationOp';
import { HashedObject } from './HashedObject';
import { Timestamps } from 'util/timestamps';

class MutableReference<T> extends MutableObject {

    static className = 'hhs/v0/MutableReference';

    typeConstraints?: Array<string>;

    _sequence?: number;
    _timestamp?: string;
    _value?: T;

    constructor() {
        super([RefUpdateOp.className]);
    }

    async mutate(op: MutationOp): Promise<void> {
        let refUpdateOp = op as RefUpdateOp<T>;

        if (refUpdateOp.getTarget().equals(this)) {
            if (this._sequence === undefined || 
                this._sequence < refUpdateOp.getSequence() ||
                (this._sequence === refUpdateOp.getSequence() && 
                 Timestamps.after(refUpdateOp.getTimestamp(), this._timestamp as string))) {

                 this._sequence = refUpdateOp.getSequence();
                 this._timestamp = refUpdateOp.getTimestamp();
                 this._value = refUpdateOp.getValue();                    
            }
        }
    }
    
    getClassName(): string {
        return MutableReference.className;
    }
    
    init(): void {
        if (this.typeConstraints !== undefined) {

            if (!Array.isArray(this.typeConstraints) ) {
                throw new Error('The field typeConstraints of class MutableReference should be an array.')
            }

            for (const typeConstraint of this.typeConstraints) {
                if ((typeof typeConstraint) !== 'string') {
                    throw new Error('The typeConstarings field of class MutableReference can only contain strings.');
                }
            }

        }
    }
    
}

class RefUpdateOp<T> extends MutationOp {

    static className = 'hhs/v0/RefUpdateOp';

    sequence?: number;
    timestamp?: string;
    value?: T;


    constructor() {
        super();
    }

    getClassName(): string {
        return RefUpdateOp.className;
    }

    init(): void {

        if (this.sequence === undefined) {
            throw new Error('The field sequence is mandatory in class RefUpdateOp');
        }

        if ((typeof this.sequence) !== 'number') {
            throw new Error('The field sequence should be of type number in class RefUpdateop');
        }

        if (this.timestamp === undefined) {
            throw new Error('The field timestamp is mandatory in class RefUpdateOp');
        }

        if ((typeof this.timestamp) !== 'string') {
            throw new Error('The field timestamp should be of type timestamp in class RefUpdateop');
        }

        if (this.value === undefined) {
            throw new Error('The field value is mandatory in class REfUpdateop');
        }

        if (this.target === undefined || 
            this.target.getClassName() !== MutableReference.className ) {
                throw new Error('A RefUpdateOp can only have a MutableReference as its target.');
        }

        let constraints = (this.target as MutableReference<T>).typeConstraints;
        let valid = false;

        if (constraints !== undefined) {
            for (const constraint of constraints) {
                if (this.hasValidType(this.value as T, constraint)) {
                    valid = true;
                    break;
                }
            }
        } else {
            valid = true;
        }

        if (!valid) {
            throw new Error('RefUpdateOp contains a value with an unexpected type.')
        }

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

    private hasValidType(value: T, typ: string) {
        if (typ === 'string') {
            return (typeof value) === 'string';
        } else if (typ === 'number') {
            return (typeof value) === 'number';
        } else {
            return (value instanceof HashedObject && value.getClassName() === typ);
        }
    }
}

HashedObject.registerClass(MutableReference.className, MutableReference);
HashedObject.registerClass(RefUpdateOp.className, RefUpdateOp);

export { MutableReference };