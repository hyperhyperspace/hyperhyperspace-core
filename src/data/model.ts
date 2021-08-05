export { HashedObject } from './model/HashedObject';
export { Literal, Dependency, LiteralUtils } from './model/Literals';
export { Context, LiteralContext } from './model/Context';
export { MutableObject } from './model/MutableObject';
export { MutationOp } from './model/MutationOp';
export { HashReference } from './model/HashReference';
export { HashedSet } from './model/HashedSet';
export { HashedLiteral } from './model/HashedLiteral';
export { Hashing, Hash } from './model/Hashing';

// commenting out because these imports trigger a weird error:

// export { ReversibleObject } from './model/ReversibleObject';
// export { ReversibleOp } from './model/ReversibleOp';

// TypeError: Object prototype may only be an Object or null: undefined
// see @oleersoy's hypothesis here:
// https://github.com/Microsoft/TypeScript/issues/28314

export { CascadedInvalidateOp } from './model/CascadedInvalidateOp';
export { InvalidateAfterOp } from './model/InvalidateAfterOp';
export { Serialization } from './model/Serialization';
export { Namespace } from './model/Namespace';
