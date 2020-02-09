import { HashedObject } from "./HashedObject";

abstract class MutableObject extends HashedObject {

    createMutationOp() {

    }

    abstract applyMutationOp(): void;

}

export { MutableObject }