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
    causalOps?: HashedSet<HashReference<MutationOp>>;

    constructor(targetObject?: MutableObject) {
        super();

        if (targetObject !== undefined) {
            this.targetObject = targetObject;
        }
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        if (this.targetObject === undefined) {
            return false;
        }

        if (!(this.targetObject instanceof MutableObject)) {
            return false;
        }

        if (this.prevOps === undefined) {
            return false;
        }

        if (!(this.prevOps instanceof HashedSet)) {
            return false;
        }

        for (const prevOpRef of this.prevOps.values()) {
            const prevOp = references.get(prevOpRef.hash);

            if (prevOp === undefined) {
                return false;
            } else if (! (prevOp instanceof MutationOp)) {
                return false
            } else if (! ((prevOp as MutationOp).targetObject as MutableObject).equals(this.targetObject)) { 
                return false;
            }
        }

        if (!this.targetObject.supportsUndo() && this.causalOps !== undefined) {
            return false;
        }

        if (this.causalOps !== undefined) {

            if (! (this.causalOps instanceof HashedSet)) {
                return false;
            }

            for (const causalOpRef of this.causalOps.values()) {
                const causalOp = references.get(causalOpRef.hash);

                if (causalOp === undefined) {
                    return false;
                } else if (! (causalOp instanceof MutationOp)) {
                    return false;
                }
            }
        }

        if (!this.targetObject.shouldAcceptMutationOp(this, references)) {
            return false;
        }
        
        return true;

    }

    setCausalOps(causalOps: IterableIterator<MutationOp>) {
        const causalOpArray = Array.from(causalOps).map((op: MutationOp) => op.createReference());
        if (causalOpArray.length > 0) {
            this.causalOps = new HashedSet(causalOpArray.values()); 
        } else {
            this.causalOps = undefined;
        }
    }

    getCausalOps() {
        if (this.causalOps === undefined) {
            throw new Error('Called getCausalOps, but this.causalOps is undefined.');
        }

        return this.causalOps as HashedSet<HashReference<MutationOp>>;
    }

    addCausalOp(causalOp: MutationOp) {
        if (this.causalOps === undefined) {
            this.causalOps = new HashedSet([causalOp.createReference()].values());
        } else {
            this.causalOps.add(causalOp.createReference());
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