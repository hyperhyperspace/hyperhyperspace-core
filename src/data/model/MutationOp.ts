import { HashedObject } from './HashedObject';
import { Context } from './Context';  
import { MutableObject } from './MutableObject';
import { HashedSet } from './HashedSet';
import { Hash } from './Hashing';
import { HashReference } from './HashReference';
import { OpHeader, OpHeaderProps } from 'data/history/OpHeader';

abstract class MutationOp extends HashedObject {

    targetObject?  : MutableObject;
    prevOps? : HashedSet<HashReference<MutationOp>>;
    causalOps?: HashedSet<MutationOp>;

    constructor(targetObject?: MutableObject) {
        super();

        if (targetObject !== undefined) {
            this.targetObject = targetObject;
        }
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        if (this.targetObject === undefined) {
            console.log('a')
            return false;
        }

        if (!(this.targetObject instanceof MutableObject)) {
            console.log('b')
            return false;
        }

        if (this.prevOps === undefined) {
            console.log('c')
            return false;
        }

        if (!(this.prevOps instanceof HashedSet)) {
            console.log('d')
            return false;
        }

        for (const prevOpRef of this.prevOps.values()) {
            const prevOp = references.get(prevOpRef.hash);

            if (prevOp === undefined) {
                console.log('e')
                return false;
            } else if (! (prevOp instanceof MutationOp)) {
                console.log('f')
                return false
            } else if (! ((prevOp as MutationOp).targetObject as MutableObject).equals(this.targetObject)) { 
                console.log('g')
                return false;
            }
        }

        if (!this.targetObject.supportsUndo() && this.causalOps !== undefined) {
            console.log('h')
            return false;
        }

        if (this.causalOps !== undefined) {

            if (! (this.causalOps instanceof HashedSet)) {
                console.log('i')
                return false;
            }

            for (const causalOp of this.causalOps.values()) {

                if (causalOp === undefined) {
                    console.log('j')
                    return false;
                } else if (! (causalOp instanceof MutationOp)) {
                    console.log('k')
                    return false;
                }
            }
        }

        if (!this.targetObject.shouldAcceptMutationOp(this, references)) {
            console.log('l')
            return false;
        }
        
        return true;

    }

    setCausalOps(causalOps: IterableIterator<MutationOp>) {
        this.causalOps = new HashedSet(causalOps); 
        if (this.causalOps.size() === 0) {
            this.causalOps = undefined;
        }
    }

    getCausalOps() {
        if (this.causalOps === undefined) {
            throw new Error('Called getCausalOps, but this.causalOps is undefined.');
        }

        return this.causalOps as HashedSet<MutationOp>;
    }

    addCausalOp(causalOp: MutationOp) {
        if (this.causalOps === undefined) {
            this.causalOps = new HashedSet([causalOp].values());
        } else {
            this.causalOps.add(causalOp);
        }
    }

    getTargetObject() : MutableObject {
        return this.targetObject as MutableObject;
    }

    setTargetObject(target: MutableObject) {
        this.targetObject = target;
    }

    getPrevOps() : IterableIterator<HashReference<MutationOp>> {
        return (this.prevOps as HashedSet<HashReference<MutationOp>>).values();
    }

    getPrevOpsIfPresent() : IterableIterator<HashReference<MutationOp>> | undefined {
        if (this.prevOps === undefined) {
            return undefined;
        } else {
            return (this.prevOps as HashedSet<HashReference<MutationOp>>).values();
        }
        
    }

    setPrevOps(prevOps: IterableIterator<MutationOp>) {
        this.prevOps = new HashedSet(Array.from(prevOps).map((op: MutationOp) => op.createReference()).values());
    }

    literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('op');

        return super.literalizeInContext(context, path, flags);

    }

    getHeader(prevOpHeaders: Map<Hash, OpHeader> ): OpHeader {
        return new OpHeader(this, prevOpHeaders);
    }
    
    getHeaderProps(prevOpHeaders: Map<Hash, OpHeader>): OpHeaderProps {
        prevOpHeaders;
        return new Map();
    }

    hasCausalOps() {
        return this.causalOps !== undefined;
    }

    nonCausalHash(): Hash {

        const currentCausalOps = this.causalOps;
        this.causalOps = undefined;
        const nonCausalHash = this.hash();
        this.causalOps = currentCausalOps;
        return nonCausalHash;

    }

}

export { MutationOp }