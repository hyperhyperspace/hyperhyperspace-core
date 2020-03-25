import { Hashing } from './Hashing';

class HashNamespace {

    static generateIdForPath(parentId: string, path: string) {
        return Hashing.forValue('#' + parentId + '.' + path);
    }

}

export { HashNamespace };