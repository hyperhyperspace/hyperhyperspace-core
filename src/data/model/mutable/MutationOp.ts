import { HashedObject } from '../immutable/HashedObject';
import { Context } from '../literals/Context';  
import { MutableObject } from './MutableObject';
import { HashedSet } from '../immutable/HashedSet';
import { Hash } from '../hashing/Hashing';
import { HashReference } from '../immutable/HashReference';
import { OpHeader, OpHeaderProps } from 'data/history/OpHeader';
import { HashedMap } from '../immutable/HashedMap';

abstract class MutationOp extends HashedObject {

    targetObject?  : MutableObject;
    prevOps? : HashedSet<HashReference<MutationOp>>;
    causalOps?: HashedMap<string, MutationOp>;

    constructor(targetObject?: MutableObject) {
        super();

        if (targetObject !== undefined) {
            this.targetObject = targetObject;
        }
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        if (this.targetObject === undefined) {
            MutationOp.validationLog.debug('Target object for ' + this.hash() + ' is missing');
            return false;
        }

        if (!(this.targetObject instanceof MutableObject)) {
            MutationOp.validationLog.debug('Target object for ' + this.hash() + ' is not an instance of MutableObject');
            return false;
        }

        if (this.prevOps === undefined) {
            MutationOp.validationLog.debug('prevOps is missing for ' + this.hash());
            return false;
        }

        if (!(this.prevOps instanceof HashedSet)) {
            MutationOp.validationLog.debug('prevOps for ' + this.hash() + ' is not an instance of HashedSet');
            return false;
        }

        for (const prevOpRef of this.prevOps.values()) {
            const prevOp = references.get(prevOpRef.hash);

            if (prevOp === undefined) {
                MutationOp.validationLog.debug('prevOps for ' + this.hash() + ' contains undefined');
                return false;
            } else if (! (prevOp instanceof MutationOp)) {
                MutationOp.validationLog.debug('a prevOp for ' + this.hash() + ' is not an instance of MutationOp');
                return false
            } else if (! ((prevOp as MutationOp).targetObject as MutableObject).equals(this.targetObject)) { 
                MutationOp.validationLog.debug('a prevOp for ' + this.hash() + ' points to another object: ' + prevOp.targetObject?.hash());
                return false;
            }
        }

        if (!this.targetObject.supportsUndo() && this.causalOps !== undefined) {
            MutationOp.validationLog.debug('The target object for ' + this.hash() + ' does not support undo, yet this op has causalOps !== undefined');
            return false;
        }

        if (this.causalOps !== undefined) {


            if (this.causalOps.size() === 0) {
                MutationOp.validationLog.debug('Empty causalOps is not allowed in MutationOp: should be undefined');
                return false;
            }

            if (! (this.causalOps instanceof HashedMap)) {
                MutationOp.validationLog.debug('causalOps for ' + this.hash() + ' is not an instance of HashedMap');
                return false;
            }

            for (const [key, causalOp] of this.causalOps.entries()) {

                if (typeof key !== 'string') {
                    MutationOp.validationLog.debug('A key for a causalOp for ' + this.hash() + ' is not of type string but ' + (typeof key));
                    return false;
                } 

                if (causalOp === undefined) {
                    MutationOp.validationLog.debug('causalOps for ' + this.hash() + ' contains undefined');
                    return false;
                } else if (! (causalOp instanceof MutationOp)) {
                    MutationOp.validationLog.debug('causalOps for ' + this.hash() + ' contains an element that is not an instance of MutationOp');
                    return false;
                }
            }
        }

        if (!this.targetObject.shouldAcceptMutationOp(this, references)) {
            MutationOp.validationLog.debug(this.hash() + ' of type ' + this.getClassName() + ' was rejected by its target of type ' + this.targetObject?.getClassName());
            return false;
        }
        
        return true;

    }

    setCausalOps(causalOps: IterableIterator<[string, MutationOp]>) {
        this.causalOps = new HashedMap(causalOps); 
        
        if (this.causalOps.size() === 0) {
            this.causalOps = undefined;
        }
    }

    getCausalOps(): HashedMap<string, MutationOp> {
        
        if (this.causalOps === undefined) {
            return new HashedMap();
        }

        return this.causalOps;
    }

    addCausalOp(key: string, causalOp: MutationOp) {
        if (this.causalOps === undefined) {
            this.causalOps = new HashedMap([[key, causalOp] as [string, MutationOp]].values());
        } else {
            const oldVal = this.causalOps.get(key);

            if (oldVal !== undefined) {
                if (causalOp.hash() !== oldVal.hash()) {
                    throw new Error('Trying to re-use causal property with name ' + key + ' in ' + this.getClassName());
                }
            }

            this.causalOps.set(key, causalOp);
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