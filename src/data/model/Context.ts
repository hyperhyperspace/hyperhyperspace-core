
import { HashedObject, Literal } from './HashedObject';
import { Hash } from './Hashing';

type LiteralContext = { rootHashes: Array<Hash>, literals: any };

class Context {

    rootHashes : Array<Hash>;
    objects  : Map<Hash, HashedObject>;
    literals : Map<Hash, Literal>;
    aliased?: Map<Hash, HashedObject>;

    constructor() {
        this.rootHashes = [];
        this.objects    = new Map();
        this.literals   = new Map();
    }

    toLiteralContext() : LiteralContext {
        return { rootHashes: Array.from(this.rootHashes), literals: Object.fromEntries(this.literals.entries()) };
    }

    fromLiteralContext(literalContext: LiteralContext) : void {
        this.rootHashes = Array.from(literalContext.rootHashes);
        this.literals = new Map(Object.entries(literalContext.literals));
        this.objects = new Map();
    }

}

export { Context, LiteralContext }