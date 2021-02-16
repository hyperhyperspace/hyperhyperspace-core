import { Literal } from "data/model";

type StoreEvent = {type: 'store-event', literal: Literal, source: string};

interface TriggerDispatcher {
    setCallback(cb: (literal: Literal) => Promise<void>): void;
    dispatch(literal: Literal): void;
}

export { TriggerDispatcher, StoreEvent };