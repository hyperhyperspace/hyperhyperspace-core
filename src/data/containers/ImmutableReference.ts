import { MutableObject } from '../model/MutableObject';
import { HashedObject } from '../model/HashedObject';
import { HashReference } from '../model/HashReference';


class ImmutableReference<T extends MutableObject> extends HashedObject {

    static className = 'hhs/v0/ImmutableReference';

    value?: HashReference<T>;

    getClassName(): string {
        return ImmutableReference.className;
    }

    init(): void {

    }

    validate(references: Map<string, HashedObject>): boolean {
        if (this.value === undefined || !(this.value instanceof HashReference)) {
            return false;
        }

        const ref = references.get(this.value.hash);
        const knownClass = HashedObject.knownClasses.get(this.value.className);

        if (ref === undefined || knownClass === undefined) {
            return false;
        }

        if (!(ref instanceof knownClass)) {
            return false;
        }

        return true;
    }
}

export { ImmutableReference };