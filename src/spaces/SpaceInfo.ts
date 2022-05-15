import { HashedLiteral, HashedObject, Hashing } from 'data/model';
import { ObjectBroadcastAgent } from 'mesh/agents/discovery';
import { SpaceEntryPoint } from './SpaceEntryPoint';


class SpaceInfo extends HashedObject {

    static className = 'hhs/v0/SpaceInfo';

    static readonly bitLengths = [11 * 4, 12 * 5, 12 * 4, 12 * 3];

    entryPoint?: HashedObject & SpaceEntryPoint;
    hashSuffixes?: Array<HashedLiteral>;

    constructor(entryPoint?: HashedObject & SpaceEntryPoint) {
        super();

        if (entryPoint !== undefined) {
            this.entryPoint = entryPoint;
            this.hashSuffixes = SpaceInfo.createHashSuffixes(this.entryPoint);
        }
    }

    getClassName(): string {
        return SpaceInfo.className;
    }

    init(): void {
        
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {

        references;

        if (this.entryPoint === undefined || this.hashSuffixes === undefined) {
            return false;
        }

        const hashSuffixes = SpaceInfo.createHashSuffixes(this.entryPoint);

        if (this.hashSuffixes.length !== hashSuffixes.length) {
            return false;
        }

        for (let i=0; i<hashSuffixes.length; i++) {
            if (this.hashSuffixes[i] !== hashSuffixes[i]) {
                return false;
            }
        }

        return true;
    }

    private static createHashSuffixes(entryPoint: HashedObject): Array<HashedLiteral> {

        const hash = entryPoint.hash();
        const hashSuffixes = new Array<HashedLiteral>();

        for (const bitLength of SpaceInfo.bitLengths) {
            hashSuffixes.push(new HashedLiteral(ObjectBroadcastAgent.hexSuffixFromHash(hash, bitLength)));
        }

        hashSuffixes.push(new HashedLiteral(Hashing.toHex(hash)));

        return hashSuffixes;
    }

}

HashedObject.registerClass(SpaceInfo.className, SpaceInfo);

export { SpaceInfo };