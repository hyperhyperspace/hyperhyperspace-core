import { Literal } from 'data/model';
import { StoreEvent, TriggerDispatcher } from './TriggerDispatcher';

class DefaultTriggerDispatcher implements TriggerDispatcher {

    backendName: string;
    dbName: string;
    instanceId: string;

    callback?: (literal: Literal) => Promise<void>;

    broadcastChannel?: BroadcastChannel;

    constructor(backendName: string, dbName: string, instanceId: string) {

        this.backendName = backendName;
        this.dbName = dbName;
        this.instanceId = instanceId;

        if (globalThis.BroadcastChannel !== undefined) {
            this.broadcastChannel = new BroadcastChannel('trigger::' + this.backendName + '/' + this.dbName);
            this.broadcastChannel.onmessage = (ev: MessageEvent<StoreEvent>) => {
                if (ev.data.type === 'store-event' && this.callback !== undefined) {
                    if (ev.data.source !== this.instanceId) {
                        this.callback(ev.data.literal);
                    }
                }
            };
        } else {
            
        }

    }

    setCallback(cb: (literal: Literal) => Promise<void>): void {
        this.callback = cb;
    }

    dispatch(literal: Literal): void {
        if (globalThis.BroadcastChannel !== undefined) {
            const dispatch: StoreEvent = {
                type: 'store-event',
                source: this.instanceId,
                literal: literal
            }
    
            this.broadcastChannel?.postMessage(dispatch);
        } else {

        }
    }
    
}

export { DefaultTriggerDispatcher };