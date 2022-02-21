import { HashedObject } from "data/model";


class ClassRegistry {
    static knownClasses = new Map<string, new () => HashedObject>();

    static register(name: string, clazz: new () => HashedObject) {
        
        const another = ClassRegistry.knownClasses.get(name);
        if (another === undefined) {
            ClassRegistry.knownClasses.set(name, clazz);
        } else if (another !== clazz) {
            throw new Error('Attempting to register two different instances of class ' + name + ', this would cause "instanceof" to give incorrect results. Check if your project has imported two instances of @hyper-hyper-space/core (maybe your dependencies are using two different versions?).')
        }
    }

    static lookup(name: string): (new () => HashedObject) | undefined {
        return ClassRegistry.knownClasses.get(name);
    }
}

export { ClassRegistry }