import { Backend, BackendSearchParams, BackendSearchResults } from 'data/storage/Backend'; 
import { HashedObject, MutableObject, ObjectLiteral, ObjectReference, Dependency } from 'data/model.ts';
import { Hash } from 'data/model/Hashing';
import { RSAKeyPair } from 'data/identity/RSAKeyPair';


type PackedLiteral = { hash : Hash, value: any, signatures : Array<[Hash, String]>,
                       dependencies: Array<PackedDependency> };

type PackedDependency = { hash: Hash, path: string, className: string, type: ('literal'|'reference') };

type LoadParams = BackendSearchParams;

class Store {

    private backend : Backend;

    constructor(backend : Backend) {
        this.backend = backend;
    }

    async save(object: HashedObject) : Promise<void>{

        let saving = this.saveWithLiteral(object.toLiteral());

        if (object instanceof MutableObject) {
            saving = saving.then(() => this.saveOperations(object));
        }

        return saving;
    }

    private async saveOperations(mutable: MutableObject) : Promise<void> {
            let pendingOps = mutable.getUnsavedOps();

            for (const op of pendingOps) {
                await this.save(op);
                mutable.removeUnsavedOp(op);
            }
    }

    private async saveWithLiteral(literal: ObjectLiteral) : Promise<void> {


        let object = literal.object;
        let loaded = await this.load(literal.hash);

        if (loaded !== undefined) {
            return Promise.resolve();
        }

        let packed = await this.packWithLiteral(object, literal);
        
        await this.backend.store(packed);
    }

    async pack(object: HashedObject) {
        let packed = await this.packWithLiteral(object, object.toLiteral());

        return packed;
    }

    private async packWithLiteral(object: HashedObject, literal: ObjectLiteral) {
        let packed = {} as PackedLiteral;

        packed.hash    = literal.hash;
        packed.value = literal.literal;
        packed.signatures = [];

        for (const author of object.getAuthors()) {

            let keyHash = author.getKeyPairHash();
            let key     = await (this.load(keyHash) as Promise<RSAKeyPair>);
            packed.signatures.push([author.hash(), key.sign(packed.hash)]);
        }

        packed.dependencies = [];

        for (const dep of literal.dependencies) {

            let packedDep = {} as PackedDependency;

            packedDep.path = dep.path;

            if ((dep.target as ObjectLiteral).literal) {
                let depLiteral = dep.target as ObjectLiteral;
                await this.saveWithLiteral(depLiteral);
                packedDep.className = depLiteral.object.getClass();
                packedDep.hash = depLiteral.hash;
                packedDep.type = 'literal';   
            } else {
                let depReference = dep.target as ObjectReference;
                packedDep.className = depReference.className;
                packedDep.hash = depReference.hash;
                packedDep.type = 'reference';
            }
            packed.dependencies.push(packedDep);
        }

        return packed;
    }

    async load(hash: Hash) : Promise<HashedObject | undefined> {

        return this.loadWithLiteral(hash).then((loaded : ObjectLiteral | undefined) => {
            return loaded?.object;
        });
    }

    async loadByClass(className: string, params?: LoadParams) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let searchResults = await this.backend.searchByClass(className, params);

        return this.unpackSearchResults(searchResults);

    }

    async loadByReference(referringClassName: string, referringPath: string, referencedHash: Hash, params?: LoadParams) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let searchResults = await this.backend.searchByReference(referringClassName, referringPath, referencedHash, params);

        return this.unpackSearchResults(searchResults);
    }

    private async loadWithLiteral(hash: Hash) : Promise<ObjectLiteral | undefined> {

        let packed = await this.backend.load(hash);
        
        if (packed === undefined) {
            return undefined;
        } else {
            return this.unpackWithLiteral(packed);
        }
       
    }

    async unpack(packed: PackedLiteral) : Promise<HashedObject> {
        let unpacked = await this.unpackWithLiteral(packed);

        return unpacked?.object as HashedObject;
    }

    private async unpackWithLiteral(packed: PackedLiteral) : Promise<ObjectLiteral | undefined> {
        let literal = {} as ObjectLiteral;

        literal.hash = packed.hash;
        literal.literal = packed.value;
        literal.dependencies = new Set<Dependency>();

        for (let i=0; i<packed.dependencies.length; i++) {
            let packedDep = packed.dependencies[i];

            let dependency = {} as Dependency;
            dependency.path = packedDep.path;

            if (packedDep.type === 'literal') {
                let loaded = await this.loadWithLiteral(packedDep.hash);
                if (loaded === undefined) {
                    throw new Error("Trying to unpack " + packed.hash + " but found unmet dependency " + packedDep.hash);
                } else {
                    dependency.target = loaded;
                }
            } else {
                dependency.target = { hash : packedDep.hash, className : packedDep.hash } as ObjectReference;
            }

            literal.dependencies.add(dependency);
        }

        HashedObject.fromLiteral(literal)

        return Promise.resolve(literal);
    }

    private async unpackSearchResults(searchResults: BackendSearchResults) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {
        let objects = [] as Array<HashedObject>;
        
        for (let packed of searchResults.items) {
            let obj = (await this.unpackWithLiteral(packed))?.object as HashedObject;
            objects.push(obj);
        }

        return {objects: objects, start: searchResults.start, end: searchResults.end};    
    }
}

export { Store, PackedLiteral };