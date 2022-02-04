import { MutableObject } from '../model/mutable/MutableObject';
import { HashedObject } from '../model/immutable/HashedObject';
import { HashReference } from '../model/immutable/HashReference';
import { ClassRegistry } from '../model/ClassRegistry';


class ImmutableReference<T extends MutableObject> extends HashedObject {

    static className = 'hhs/v0/ImmutableReference';

    value?: HashReference<T>;

    getClassName(): string {
        return ImmutableReference.className;
    }

    init(): void {

    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        if (this.value === undefined || !(this.value instanceof HashReference)) {
            return false;
        }

        const ref = references.get(this.value.hash);
        const knownClass = ClassRegistry.lookup(this.value.className);

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