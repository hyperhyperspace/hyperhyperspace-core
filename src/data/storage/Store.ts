import { Backend } from 'data/storage/Backend'; 
import { HashedObject, Literal, Dependency } from 'data/model/HashedObject';
import { Hash } from 'data/model/Hashing';
import { RSAKeyPair } from 'data/identity/RSAKeyPair';


type PackedLiteral = { 
    hash : Hash,
    value: any,
    signatures : Map<Hash, string>,
    dependencies: Array<Hash>,
    references: Array<string>
};


class Store {

    private backend : Backend;

    constructor(backend : Backend) {
        this.backend = backend;
    }

    async save(object: HashedObject) {
        return this.saveWithLiteral(object, object.toLiteral());
    }

    private async saveWithLiteral(object: HashedObject, literal: Literal) : Promise<void> {

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

    private async packWithLiteral(object: HashedObject, literal: Literal) {
        let packed = {} as PackedLiteral;

        packed.hash    = literal.hash;
        packed.value = literal.value;
        packed.signatures = new Map<Hash, string>();

        for (const author of object.getAuthors()) {

            let keyHash = author.getKeyPairHash();
            let key     = await (this.load(keyHash) as Promise<RSAKeyPair>);
            packed.signatures.set(author.hash(), key.sign(packed.hash));

        }

        packed.dependencies = new Array<Hash>();
        packed.references = new Array<string>();

        for (const dep of literal.dependencies) {
            await this.saveWithLiteral(dep.object, dep.literal);
            packed.dependencies.push(dep.literal.hash);
            packed.references.push(literal.value.class + '.' + dep.path);
        }

        return packed;
    }

    async load(hash: Hash) : Promise<HashedObject | undefined> {

        return this.loadWithLiteral(hash).then((loaded : {object: HashedObject, literal: Literal} | undefined) => {
            return loaded?.object;
        });
    }

    private async loadWithLiteral(hash: Hash) : Promise<{object: HashedObject, literal: Literal} | undefined> {

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

    private async unpackWithLiteral(packed: PackedLiteral) : Promise<{object: HashedObject, literal: Literal} | undefined> {
        let literal = {} as Literal;

        literal.hash = packed.hash;
        literal.value = packed.value;
        literal.dependencies = new Set<Dependency>();

        for (let i=0; i<packed.dependencies.length; i++) {
            let dependencyHash = packed.dependencies[i];
            let dependencyPath = packed.references[i];

            let dependency = {} as Dependency;

            let loaded = await (this.loadWithLiteral(dependencyHash) as Promise<{object: HashedObject, literal: Literal}>);
            
            dependency.object  = loaded.object;
            dependency.literal = loaded.literal;
            dependency.path    = dependencyPath;

            literal.dependencies.add(dependency);
        }

        let hashedObject = HashedObject.fromLiteral(literal)

        return Promise.resolve({object: hashedObject, literal: literal});
    }
}

export { Store, PackedLiteral };