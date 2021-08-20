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

    constructor(targetObject?: MutableObject, causalOps?: IterableIterator<MutationOp>) {
        super();

        if (targetObject !== undefined) {
            this.targetObject = targetObject;
            if (causalOps !== undefined) {
                this.causalOps = new HashedSet(Array.from(causalOps).map((op: MutationOp) => op.createReference()).values());
            }
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

                /*const thisIsACascade = this instanceof CascadedInvalidateOp;

                if (causalOp instanceof CascadedInvalidateOp) {
                    if (!thisIsACascade) {
                        return false;
                    }
                }*/
            }
        }

        if (!this.targetObject.shouldAcceptMutationOp(this)) {
            return false;
        }

        if (!(await this.validateCausalOps(references))) {
            return false;
        }
        
        return true;

    }

    getCausalOps() {
        if (this.causalOps === undefined) {
            throw new Error('Called getCausalOps, but this.causalOps is undefined.');
        }

        return this.causalOps as HashedSet<HashReference<MutationOp>>;
    }

    // By default, reject any causal ops. Override if necessary.
    async validateCausalOps(references: Map<Hash, HashedObject>): Promise<boolean> {
        references;

        return this.causalOps === undefined;
    }

    shouldAcceptInvalidateAfterOp(op: MutationOp): boolean {
        op;
        return false;
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

}

export { MutationOp }