import { Backend, BackendSearchParams, BackendSearchResults } from 'data/storage/Backend'; 
import { HashedObject, MutableObject, Literal, Dependency, Context } from 'data/model.ts';
import { Hash } from 'data/model/Hashing';
import { RSAKeyPair } from 'data/identity/RSAKeyPair';
import { Identity } from 'data/identity/Identity';
import { MutationOp } from 'data/model/MutationOp';


type PackedLiteral = { hash : Hash, value: any, signatures : Array<[Hash, string]>,
                       dependencies: Array<Dependency> };

type LoadParams = BackendSearchParams;

class Store {

    private backend : Backend;

    constructor(backend : Backend) {
        this.backend = backend;
    }

    async save(object: HashedObject) : Promise<void>{

        let literalContext = object.toLiteralContext();
        let hash    = literalContext.rootHash as Hash;
        let context = { rootHash: hash, literals: literalContext.literals, objects: new Map() };

        let saving = this.saveWithContext(hash, context);

        if (object instanceof MutableObject) {
            saving = saving.then(() => this.saveOperations(object));
        }

        return saving;
    }

    private async saveOperations(mutable: MutableObject) : Promise<void> {


        let op = mutable.dequeueOpToSave();
        
        while (op !== undefined) {
            try {
                await this.save(op);
            } catch (e) {
                mutable.requeueOpToSave(op);
                throw e;
            }
            op = mutable.dequeueOpToSave();
        }
    }

    private async saveWithContext(hash: Hash, context: Context) : Promise<void> {


        let loaded = await this.load(hash);

        if (loaded !== undefined) {
            return Promise.resolve();
        }

        let literal = context.literals.get(hash);
        
        if (literal === undefined) {
            throw new Error('Hash ' + hash + ' is missing from context received for saving');
        }

        for (let dependency of literal.dependencies) {
            if (dependency.type === 'literal') {
                await this.saveWithContext(dependency.hash, context);
            }
        }

        let packed = await this.packLiteral(literal, context);
        
        let prevOps = undefined;
        let obj = context.objects.get(hash);
        if (obj instanceof MutationOp) {
            prevOps = Array.from((obj as MutationOp).getPrevOps()).map((op:MutationOp) => op.hash());
        }


        await this.backend.store(packed, prevOps);
    }
    
    /*async pack(object: HashedObject) {
        let packed = await this.packLiteral(object.toLiteral());

        return packed;
    }*/

    private async packLiteral(literal: Literal, context: Context) {
        let packed = {} as PackedLiteral;

        packed.hash  = literal.hash;
        packed.value = literal.value;
        packed.signatures = [];

        for (const authorHash of literal.authors) {

            let author = context.objects.get(authorHash) as Identity;
            let keyHash = author.getKeyPairHash();
            let key     = await (this.load(keyHash) as Promise<RSAKeyPair>);
            packed.signatures.push([author.hash(), key.sign(packed.hash)]);
        }

        packed.dependencies = Array.from(literal.dependencies);        return packed;
    }

    async load(hash: Hash) : Promise<HashedObject | undefined> {

        let context : Context = { objects: new Map<Hash, HashedObject>(),
                                  literals: new Map<Hash, Literal>() };

        return this.loadWithContext(hash, context);
    }

    private async loadWithContext(hash: Hash, context: Context) : Promise<HashedObject | undefined> {

        let literal = await this.loadLiteral(hash);

        if (literal === undefined) {
            return undefined;
        }

        return this.loadLiteralWithContext(literal, context);
    }

    private async loadLiteralWithContext(literal: Literal, context: Context) : Promise<HashedObject> {

        context.literals.set(literal.hash, literal);

        for (let dependency of literal.dependencies) {
            if (dependency.type === 'literal') {
                if (context.literals.get(dependency.hash) === undefined) {
                    let depLiteral = await this.loadLiteral(dependency.hash);
                    
                    // NO NEED to this.loadLiteralWithContext(depLiteral as Literal, context)
                    // because all transitive deps are in object deps.
                    context.literals.set(dependency.hash, depLiteral as Literal);
                }
            }
        }

        let newContext = { rootHash: literal.hash, objects: context.objects, literals: context.literals };

        return HashedObject.fromContext(newContext);
    }

    async loadByClass(className: string, params?: LoadParams) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let searchResults = await this.backend.searchByClass(className, params);

        return this.unpackSearchResults(searchResults);

    }

    async loadByReference(referringClassName: string, referringPath: string, referencedHash: Hash, params?: LoadParams) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let searchResults = await this.backend.searchByReference(referringClassName, referringPath, referencedHash, params);

        return this.unpackSearchResults(searchResults);
    }

    private async loadLiteral(hash: Hash) : Promise<Literal | undefined> {

        let packed = await this.backend.load(hash);
        
        if (packed === undefined) {
            return undefined;
        } else {
            return this.unpackLiteral(packed);
        }
       
    }

    /*async unpack(packed: PackedLiteral, context: Context) : Promise<HashedObject> {
        let unpacked = await this.unpackLiteral(packed);

        return HashedObject.fromLiteral(unpacked);
    }*/

    private unpackLiteral(packed: PackedLiteral) : Literal {
        let literal = {} as Literal;

        literal.hash = packed.hash;
        literal.value = packed.value;
        literal.dependencies = new Set<Dependency>(packed.dependencies);
        literal.authors = packed.signatures.map((sig: [Hash, string]) => sig[0]);

        return literal;
    }

    private async unpackSearchResults(searchResults: BackendSearchResults) : Promise<{objects: Array<HashedObject>, start?: string, end?: string}> {

        let context : Context = { objects: new Map<Hash, HashedObject>(),
                                  literals: new Map<Hash, Literal>() };

        let objects = [] as Array<HashedObject>;
        
        for (let packed of searchResults.items) {

            let obj = await this.loadLiteralWithContext(this.unpackLiteral(packed), context);
            objects.push(obj);
        }

        return {objects: objects, start: searchResults.start, end: searchResults.end};    
    }

    async loadTerminalOps(hash: Hash) : Promise<Array<MutationOp>> {
        let terminalOpHashes = await this.backend.loadTerminalOps(hash);
        let terminalOps : Array<MutationOp> = [];

        for (const opHash of terminalOpHashes) {
            let op = await this.load(opHash)
            terminalOps.push(op as MutationOp);
        }

        return terminalOps;
    }
}

export { Store, PackedLiteral };