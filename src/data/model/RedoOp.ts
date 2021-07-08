import { HashedObject } from './HashedObject';
import { Context } from './Context';
import { Hash } from './Hashing';
import { HashReference } from './HashReference';
import { InvalidateAfterOp } from './InvalidateAfterOp';
import { MutationOp } from './MutationOp';
import { UndoOp } from './UndoOp';


class RedoOp extends MutationOp {

    static className = 'hhs/v0/RedoOp';

    targetUndoOp? : UndoOp; // the undo op that will be reversed
    targetOp?     : HashReference<MutationOp>; // the targetOp of the targetUndoOp
    // (we need an explicit reference because we need it for validation)
    
    reason?: HashReference<UndoOp|RedoOp>;
    // Either the targetUndoOp was created because of an
    // InvalidateAfterOp that has been undone by UndoOp above,
    // or this redo is a cascading of another RedoOp, referenced
    // above.

    // So to be clear: if reason is an UndoOp, it _must_ be
    // invalidating an InvalidateAfterOp that is the reason for
    // this.targetUndoOp.

    constructor(targetUndoOp?: UndoOp, reason?: UndoOp|RedoOp) {
        super(targetUndoOp?.target);

        if (targetUndoOp !== undefined) {
            this.targetUndoOp = targetUndoOp;
            this.targetOp     = targetUndoOp.getTarget().createReference();

            if (reason === undefined) {
                throw new Error('Creating redo op, but no reason was provided.');
            }

            this.reason = reason.createReference();
            
            // this is tricky, some sanity checks:

            if (reason instanceof UndoOp) {

                // check that targetUndoOp is caused by an InvalidateAfterOp.
                if (targetUndoOp.reason?.className !== InvalidateAfterOp.className) {
                    throw new Error('Trying to create a RedoOp using an UndoOp as reason, but then the undo must point to an InvalidateAfterOp!');
                }

                const targetUndoOpReason = targetUndoOp.reason as HashReference<InvalidateAfterOp>;

                // check that said InvalidateAfterOp is being undone by reason
                if (targetUndoOpReason.hash !== reason.targetOp?.hash()) {
                    throw new Error('Trying to create a RedoOp using an UndoOp as reason, but the received UndoOp is not targeting the original InvalidateAfterOp as it should.');
                }

                // OK: targetUndoOp is a consequence of an InvalidateAfterOp that is being 
                //     undone by this.reason.

            } else if (reason instanceof RedoOp) {

                // check that targetUndoOp is caused by another UndoOp.
                if (targetUndoOp.reason?.className !== UndoOp.className) {
                    throw new Error('Trying to create a RedoOp using another RedoOp as reason, but the targetUndoOp must have an UndoOp as reason.');
                }

                const targetUndoOpReason = targetUndoOp.reason as HashReference<UndoOp>;

                // check that the RedoOp received as reason is redoing the undo that targetUndoOp has as reason
                if (targetUndoOpReason.hash !== reason.targetUndoOp?.hash()) {
                    throw new Error('Trying to create a RedoOp by cascading another RedoOp, but targets do not match.');
                }

                // OK: targetUndoOp is cascading another undoOp, that is being redone by reason.
            }
        }
        
    }

    getClassName(): string {
        return RedoOp.className;
    }

    init(): void {
        
    }

    async validate(references: Map<Hash, HashedObject>): Promise<boolean> {

        if (!(await super.validate(references))) {
            return false;
        }

        if (this.getAuthor() !== undefined) {
            return false;
        }

        if (this.isConsequence()) {
            return false;
        }

        if (this.targetUndoOp === undefined) {
            return false;
        }

        if (!(this.targetUndoOp instanceof UndoOp)) {
            return false;
        }

        if (this.reason === undefined) {
            return false;
        }

        if (!(this.reason instanceof HashReference)) {
            return false;
        }

        const reason = references.get(this.reason?.hash);

        if (reason instanceof UndoOp) {

            // check that targetUndoOp is caused by an InvalidateAfterOp.
            if (this.targetUndoOp.reason?.className !== InvalidateAfterOp.className) {
                throw new Error('Trying to create a RedoOp using an UndoOp as reason, but then the undo must point to an InvalidateAfterOp!');
            }

            const targetUndoOpReason = this.targetUndoOp.reason as HashReference<InvalidateAfterOp>;

            // check that said InvalidateAfterOp is being undone by reason
            if (targetUndoOpReason.hash !== reason.targetOp?.hash()) {
                throw new Error('Trying to create a RedoOp using an UndoOp as reason, but the received UndoOp is not targeting the original InvalidateAfterOp as it should.');
            }

            // OK: targetUndoOp is a consequence of an InvalidateAfterOp that is being 
            //     undone by this.reason.

        } else if (reason instanceof RedoOp) {

            // check that targetUndoOp is caused by another UndoOp.
            if (this.targetUndoOp.reason?.className !== UndoOp.className) {
                throw new Error('Trying to create a RedoOp using another RedoOp as reason, but the targetUndoOp must have an UndoOp as reason.');
            }

            const targetUndoOpReason = this.targetUndoOp.reason as HashReference<UndoOp>;

            // check that the RedoOp received as reason is redoing the undo that targetUndoOp has as reason
            if (targetUndoOpReason.hash !== reason.targetUndoOp?.hash()) {
                throw new Error('Trying to create a RedoOp by cascading another RedoOp, but targets do not match.');
            }

            // OK: targetUndoOp is cascading another undoOp, that is being redone by reason.
        }

        return true;

    }

    getTargetUndoOp() : UndoOp {
        return this.targetUndoOp as UndoOp;
    }

    literalizeInContext(context: Context, path: string, flags?: Array<string>) : Hash {

        if (flags === undefined) {
            flags = [];
        }

        flags.push('redo');

        return super.literalizeInContext(context, path, flags);

    }

}

HashedObject.registerClass(RedoOp.className, RedoOp);

export { RedoOp };