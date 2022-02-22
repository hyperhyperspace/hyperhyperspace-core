
import { Context, HashedLiteral, HashedObject, HashedSet, HashedMap, Hashing } from 'data/model';

class Wrapper extends HashedObject {

    static className = 'compat/Wrapper';

    something?: HashedObject;

    constructor(something?: any) {
        super();
        this.something = something;
    }

    getClassName(): string {
        return Wrapper.className;
    }

    init(): void {
        
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        references;
        return this.something !== undefined;
    }
}

HashedObject.registerClass(Wrapper.className, Wrapper);

const literals = ['a string', 123, 1.5, {'a': 'value'}, [1, 'two', 3]];
const hashedLiterals = literals.map((x: any) => new HashedLiteral(x));

const checkLiterals = {
    slug: 'hashing-01',
    desc: 'HashedLiteral check',
    gen: () => {
        return hashedLiterals.values() as IterableIterator<HashedObject>;
    },
    check: (ctx: Context) => {

        for (const hashedLiteral of hashedLiterals) {
            const toCheck = ctx.objects.get(hashedLiteral.hash());

            if (toCheck === undefined) {
                console.log('-> HashedLiteral with hash ' + hashedLiteral.hash() + ' is missing');
                return false;
            }

            if (!(toCheck instanceof HashedLiteral)) {
                console.log('-> HashedLiteral with hash ' + hashedLiteral.hash() + ' is not a HashedLiteral instance.');
                return false;
            }

            if (Hashing.default(toCheck.value) !== Hashing.default(hashedLiteral.value)) {
                console.log('-> HashedLiteral with hash ' + hashedLiteral.hash() + ' is is expected to have value:');
                console.log(toCheck.value);
                console.log('-> but has value:');
                console.log(hashedLiteral.value);
                return false;
            }
        }

        return true;
    }
}

const setElements = [[], [1, 2, 3], hashedLiterals, [new HashedSet()]];
const hashedSets = setElements.map((x: Array<any>) => new HashedSet(x.values()));
const wrappedHashedSets = hashedSets.map((x: HashedSet<any>) => new Wrapper(x));

const checkHashedSets = {
    slug: 'hashing-02',
    desc: 'HashedSet check',
    gen: () => {
        return wrappedHashedSets.values() as IterableIterator<HashedObject>;
    },
    check: (ctx: Context) => {
        for (const wrap of wrappedHashedSets) {

            const hashedSet = wrap.something as any as HashedSet<any>;
            
            const wrapToCheck = ctx.objects.get(wrap.hash());

            if (!(wrapToCheck instanceof Wrapper)) {
                console.log('-> the wrapper with hash ' + wrap.hash() + ' is missing (it wraps ' + wrap.something?.hash() + ').')
                return false;
            }

            const toCheck = wrapToCheck.something;

            if (toCheck === undefined) {
                console.log('-> the wrapper with hash ' + wrap.hash() + ' is empty.')
                return false;
            }

            if (!(toCheck instanceof HashedSet)) {
                console.log('-> the wrapper with hash ' + wrap.hash() + ' contains something else than a HashedSet.');
                return false;
            }

            if (toCheck.size() !== hashedSet.size()) {
                console.log('-> the set with hash ' + hashedSet.hash() + ' is expected to have ' + hashedSet.size() + ' elements, but has ' + toCheck.size())
                return false;
            }

            for (const elmt of toCheck.values()) {
                if (!hashedSet.has(elmt)) {
                    console.log('-> value ' + elmt + ' is missing from set with hash ' + hashedSet.hash());
                    return false;
                }
            }
        }

        return true;
    }

}

const maps = [{'a': new HashedLiteral(6), 'b': new HashedLiteral(-7)}, {}]
const hashedMaps = maps.map((x: any) => new HashedMap(Object.entries(x).values()));
const wrappedHashedMaps = hashedMaps.map((x: HashedMap<any, any>) => new Wrapper(x));

const checkHashedMaps = {
    slug: 'hashing-03',
    desc: 'HashedMap check',
    gen: () => {
        return wrappedHashedMaps.values();
    },
    check: (ctx: Context) => {
        for (const wrap of wrappedHashedMaps) {

            const hashedMap = wrap.something as any as HashedMap<any, any>;

            const wrapToCheck = ctx.objects.get(wrap.hash());

            if (!(wrapToCheck instanceof Wrapper)) {
                return false;
            }

            const toCheck = wrapToCheck.something;

            if (toCheck === undefined) {
                return false;
            }

            if (!(toCheck instanceof HashedMap)) {
                return false;
            }

            if (toCheck.size() !== hashedMap.size()) {
                return false;
            }

            for (const key of toCheck.keys()) {
                if (!(hashedMap.get(key) as HashedObject).equals((toCheck.get(key)))) {
                    return false;
                }
            }
        }

        return true;
    }
}

const checks = [checkLiterals, checkHashedSets, checkHashedMaps];

export default checks;
