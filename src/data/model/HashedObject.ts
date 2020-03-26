import { Hashing, Hash } from './Hashing';
import { HashedSet } from './HashedSet';
import { Identity } from 'data/identity/Identity';
import { HashReference } from './HashReference';
import { __spreadArrays } from 'tslib';
import { RNGImpl } from 'crypto/random';
import { HashNamespace } from './HashNamespace';

type Literal           = { hash: Hash, value: any, authors: Array<Hash>, dependencies: Set<Dependency> }
type Dependency        = { path: string, hash: Hash, className: string, type: ('literal'|'reference') };

type Context = { objects: Map<Hash, HashedObject>, literals: Map<Hash, Literal> };
type LiteralContext = { hash: Hash, context: Context };

const BITS_FOR_ID = 128;

class HashedObject {

    static knownClasses = new Map<string, new () => HashedObject>();
    static registerClass(name: string, clazz: new () => HashedObject) {
        this.knownClasses.set(name, clazz);
    }

    private id?     : string;
    private authors : HashedSet<Identity>;

    constructor() {
        this.authors = new HashedSet<Identity>();
    } 

    init() {
        
    }

    getId() : (string | undefined) {
        return this.id;
    }

    setId(id: string) {
        this.id = id;
    }

    setRandomId() {
        //TODO: use b64 here
        this.id = new RNGImpl().randomHexString(BITS_FOR_ID);
    }

    addAuthor(author: Identity) {
        this.authors.add(author);
    }

    getAuthors() {
        return this.authors;
    }

    overrideChildrenId() : void {
        for (const fieldName of Object.keys(this)) {
            if (fieldName.length > 0 && fieldName[0] !== '_') {
                let value = (this as any)[fieldName];
                if (value instanceof HashedObject) {
                    this.overrideIdForPath(fieldName, value);
                }
            }
        }
    }

    overrideIdForPath(path: string, target: HashedObject) : void {
        let parentId = this.getId();

        if (parentId === undefined) {
            throw new Error("Can't override a child's Id because parent's Id is unset");
        }

        target.setId(HashNamespace.generateIdForPath(parentId, path));
    }

    hash() {
        return this.toLiteralContext().hash;
    }

    createReference() : HashReference {
        return new HashReference(this.hash(), this.getClassName());
    }

    getClassName() {
        return 'HashedObject';
    }

    toLiteralContext() : LiteralContext {

         let context = { objects: new Map(), literals: new Map() } as Context

         let hash = this.literalizeInContext(context, '');

         return {hash: hash, context: context };
    }

    literalizeInContext(context: Context, path: string) : Hash {
        
        let fields = {} as any;
        let dependencies = new Set<Dependency>();

        for (const fieldName of Object.keys(this)) {
            if (fieldName.length > 0 && fieldName[0] !== '_') {
                let value = (this as any)[fieldName];

                if (HashedObject.shouldLiteralizeField(value)) {
                    let fieldPath = fieldName;
                    if (path !== '') {
                        fieldPath = path + '.' + fieldName;
                    }
                    let fieldLiteral = HashedObject.literalizeField(fieldPath, value, context);
                    fields[fieldName] = fieldLiteral.value;
                    HashedObject.collectChildDeps(dependencies, fieldLiteral.dependencies);
                }
            }
        }
        
        let value = {
            _type: 'hashed_object', 
            _class: this.getClassName(),
            _fields : fields
        };

        let hash = Hashing.forValue(value);
        
        let authors = value['_fields']['authors']['_hashes'] as Array<Hash>;

        let literal: Literal = { hash: hash, value: value, authors: authors , dependencies: dependencies };

        context.objects.set(hash, this);
        context.literals.set(hash, literal);

        return hash;
    }

    equals(another: HashedObject) {
        return this.hash() === another.hash();
    }

    clone() : this {
        let lc = this.toLiteralContext();
        lc.context.objects = new Map<Hash, HashedObject>();

        let clone = HashedObject.fromLiteralContext(lc) as this;

        return clone;
    }

    static shouldLiteralizeField(something: any) {

        if (something === null) {
            throw new Error('HashedObject and its derivatives do not support null-valued fields.');
        }

        if (something === undefined) {
            return false;
        } else {
            let typ = typeof(something);

            if (typ === 'function' || typ === 'symbol') {
                return false;
            } else {
                return true;
            }
        }
    }

    static literalizeField(fieldPath: string, something: any, context?: Context) : { value: any, dependencies : Set<Dependency> }  {

        let typ = typeof(something);

        let value;
        let dependencies = new Set<Dependency>();

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            value = something;
        } else if (typ === 'object') {
            if (Array.isArray(something)) {
                value = [];
                let index = 0;
                for (const elmt of something) {
                    if (HashedObject.shouldLiteralizeField(elmt)) {
                        let child = HashedObject.literalizeField(fieldPath, elmt, context); // should we put the index into the path? but then we can't reuse this code for sets...
                        value.push(child.value);
                        HashedObject.collectChildDeps(dependencies, child.dependencies);
                        index = index + 1;
                    }
                }
            } else if (something instanceof HashedSet) {
                let hset = something as HashedSet<any>;
                let arrays = hset.toArrays();
                let hashes = arrays.hashes;
                let child = HashedObject.literalizeField(fieldPath, arrays.elements, context);
                let elements = child.value;
                HashedObject.collectChildDeps(dependencies, child.dependencies);

                value = {_type: 'hashed_set', _hashes: hashes, _elements: elements};

            } else { // not a set nor an array

                if (something instanceof HashReference) {
                    let reference = something as HashReference;

                    let dependency : Dependency = { path: fieldPath, hash: reference.hash, className: reference.className, type: 'reference'};
                    dependencies.add(dependency);

                    value = { _type: 'hashed_object_reference', _hash: reference.hash, _class: reference.className};
                } else if (something instanceof HashedObject) {
                    let hashedObject = something as HashedObject;

                    if (context === undefined) {
                        throw new Error('Context needed to deliteralize HashedObject');
                    }

                    let hash = hashedObject.literalizeInContext(context, fieldPath);

                    let dependency : Dependency = { path: fieldPath, hash: hash, className: hashedObject.getClassName(), type: 'literal'};
                    dependencies.add(dependency);

                    value = { _type: 'hashed_object_dependency', _hash: hash };
                } else {
                    value = {} as any;

                    for (const fieldName of Object.keys(something)) {
                        if (fieldName.length>0 && fieldName[0] !== '_') {
                            let fieldValue = (something as any)[fieldName];
                            if (HashedObject.shouldLiteralizeField(fieldValue)) {
                                let field = HashedObject.literalizeField(fieldPath + '.' + fieldName, fieldValue, context);
                                value[fieldName] = field.value;
                                HashedObject.collectChildDeps(dependencies, field.dependencies);
                            }
                        }
                    }
                }
            }
        } else {
            throw Error("Unexpected type encountered while attempting to literalize: " + typ);
        }

        return { value: value, dependencies: dependencies };
    }


    static fromLiteralContext(literalContext: LiteralContext ) : HashedObject {
        let context = literalContext.context;

        let literal = context.literals.get(literalContext.hash);
        
        if (literal === undefined) {
            throw new Error('Literal with hash ' + literalContext.hash + ' is missing from deliteralization context');
        }

        HashedObject.deliteralizeInContext(literal, context);

        return context.objects.get(literalContext.hash) as HashedObject;
    }

    static deliteralizeInContext(literal: Literal, context: Context) : void {

        let hashedObject = context.objects.get(literal.hash);

        if (hashedObject !== undefined) {
            return;
        }

        const value = literal.value;

        for (const dep of literal.dependencies) {
            if (dep.type === 'literal') {
                let depHashedObject = context.objects.get(dep.hash);
                if (depHashedObject === undefined) {
                    let depLiteral = context.literals.get(dep.hash);
                    if (depLiteral === undefined) {
                        throw new Error('Literal with hash ' + literal.hash + ' has missing dependency ' + dep.hash + ' in deliteralization context');
                    }
                    HashedObject.deliteralizeInContext(depLiteral, context);
                    depHashedObject = context.objects.get(dep.hash) as HashedObject;
                }
            }   
        }

        // all the dependencies have been delieralized in the context

        if (value['_type'] !== 'hashed_object') {
            throw new Error("Missing 'hashed_object' type signature while attempting to deliteralize " + literal.hash);
        }
        
        let constr = HashedObject.knownClasses.get(value['_class']);

        

        if (constr === undefined) {
            hashedObject = new HashedObject();
        } else {
            hashedObject = new constr();
        }

        for (const [fieldName, fieldValue] of Object.entries(value['_fields'])) {
            if (fieldName.length>0 && fieldName[0] !== '_') {
                (hashedObject as any)[fieldName] = HashedObject.deliteralizeField(fieldValue, context);
            }
        }

        hashedObject.init();

        context.objects.set(literal.hash, hashedObject);
    }

    static deliteralizeField(value: any, context: Context) : any  {

        let something: any;

        let typ = typeof(value);

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            something = value;
        } else if (typ === 'object') {
            if (Array.isArray(value)) {
                something = [];
               for (const elmt of value) {
                   something.push(HashedObject.deliteralizeField(elmt, context));
               }
            } else if (value['_type'] === undefined) {
                something = {} as any;

                for (const [fieldName, fieldValue] of Object.entries(value)) {
                    something[fieldName] = HashedObject.deliteralizeField(fieldValue, context);
                }
            } else {
                if (value['_type'] === 'hashed_set') {
                    let hashes = value['_hashes'];
                    let elements = HashedObject.deliteralizeField(value['_elements'], context);
                    
                    something = new HashedSet();
                    something.fromArrays(hashes, elements);
                } else if (value['_type'] === 'hashed_object_reference') {
                    something = new HashReference(value['_hash'], value['_class']);
                } else if (value['_type'] === 'hashed_object_dependency') {
                    let hash = value['_hash'];
                    let literal = context.literals.get(hash);

                    if (literal === undefined) {
                        throw new Error('Literal ' + hash + ' is missing in deliteralization context' );
                    }

                    HashedObject.deliteralizeInContext(literal, context);

                    something = context.objects.get(hash) as HashedObject;
                } else if (value['_type'] === 'hashed_object') {
                    throw new Error("Attempted to deliteralize embedded hashed object in literal (a hash reference should be used instead)");
                } else {
                    throw new Error("Unknown _type value found while attempting to deliteralize: " + value['_type']);
                }
            }
        } else {
            throw Error("Unexpected type encountered while attempting to deliteralize: " + typ);
        }

        return something;
    }

    static collectChildDeps(parentDeps : Set<Dependency>, childDeps : Set<Dependency>) {
        for (const childDep of childDeps) {
            parentDeps.add(childDep);
        }
    }

    // the following only for pretty printing.

    static stringifyLiteral(literal: {value: any, dependencies : Map<Hash, any>}) : string {
        return HashedObject.stringifyLiteralWithIndent(literal, 0);
    }

    private static stringifyLiteralWithIndent(literal: {value: any, dependencies : Map<Hash, any>}, indent: number) : string{
       
        const value = literal['value'];
        const dependencies = literal['dependencies'];

        let something: string;

        let typ = typeof(value);

        let tab = '\n' + ' '.repeat(indent * 4);

        if (typ === 'boolean' || typ === 'number' || typ === 'string') {
            something = value;
        } else if (typ === 'object') {
            if (Array.isArray(value)) {
                if (value.length > 0) {
                    something =  tab + '[';
                    let first = true;
                    for (const elmt of value) {
                        if (!first) {
                            something = something + tab + ',';
                        }
                        first = false;
                        something = something + HashedObject.stringifyLiteralWithIndent({value: elmt, dependencies: dependencies}, indent + 1);
                    }
                } else {
                    return '[]';
                }
                
               something = something + tab + ']';
            } else if (value['_type'] === 'hashed_set') {
                something = tab + 'HashedSet =>';
                something = something + HashedObject.stringifyLiteralWithIndent({value: value['_elements'], dependencies: dependencies}, indent + 1);

            } else {
                if (value['_type'] === 'hash') {
                    let hash = value['_content'];
                    something = HashedObject.stringifyLiteralWithIndent({value: dependencies.get(hash), dependencies: dependencies}, indent);
                } else {
                    something = tab;
                    let contents;
                    if (value['_type'] === 'hashed_object') {
                        let constr = HashedObject.knownClasses.get(value['_class']);
                        if (constr === undefined) {
                            something = something + 'HashedObject: ';
                        } else {
                            something = something + value['_class'] + ' ';
                        }
                        contents = value['_contents'];
                    } else {
                        contents = value;
                    }

                    something = something + '{';
                    
                    for (const [key, propValue] of Object.entries(contents)) {
                        something = something + tab + '  ' + key + ':' + HashedObject.stringifyLiteralWithIndent({value: propValue, dependencies: dependencies}, indent + 1);
                    }

                    something = something + tab + '}'
                }
            }
        } else {
            throw Error("Unexpected type encountered while attempting to deliteralize: " + typ);
        }

        return something;

    }

    static stringifyHashedLiterals(hashedLiterals: {hash: Hash, literals: Map<Hash, any>}) : string {
        let s = '';

        for (let hash of hashedLiterals['literals'].keys()) {
            s = s + hash + ' =>';
            s = s + HashedObject.stringifyLiteralWithIndent({'value': hashedLiterals['literals'].get(hash), dependencies: hashedLiterals['literals']}, 1);
        }

        return s;
    }

}

HashedObject.registerClass('HashedObject', HashedObject);

export { HashedObject, Literal, Dependency, LiteralContext, Context };