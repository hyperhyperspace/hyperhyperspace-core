import { Literal } from 'data/model';
import { MultiMap } from 'util/multimap';
import { StoreEvent, TriggerDispatcher } from './TriggerDispatcher';

class DefaultTriggerDispatcher implements TriggerDispatcher {

    static channels = new MultiMap<string, (ev: StoreEvent) => Promise<void>>();

    backendName: string;
    dbName: string;
    instanceId: string;

    callback: (literal: Literal) => Promise<void>;

    broadcastChannel?: BroadcastChannel;

    constructor(callback: (literal: Literal) => Promise<void>, backendName: string, dbName: string, instanceId: string) {

        this.backendName = backendName;
        this.dbName = dbName;
        this.instanceId = instanceId;

        this.callback = callback;

        

        if (globalThis.BroadcastChannel !== undefined) {
            this.broadcastChannel = new BroadcastChannel(this.channelName());
            this.broadcastChannel.onmessage = (ev: MessageEvent<StoreEvent>) => {
                if (ev.data.type === 'store-event' && this.callback !== undefined) {
                    if (ev.data.source !== this.instanceId) {
                        this.callback(ev.data.literal);
                    }
                }
            };
        } else {
            DefaultTriggerDispatcher.channels.add(this.channelName(), async (ev: StoreEvent) =>  {
                if (ev.source !== this.instanceId) {
                    this.callback(ev.literal)
                }
            });
        }

    }

    setCallback(cb: (literal: Literal) => Promise<void>): void {
        this.callback = cb;
    }

    dispatch(literal: Literal): void {

        const ev: StoreEvent = {
            type: 'store-event',
            source: this.instanceId,
            literal: literal
        }

        if (globalThis.BroadcastChannel !== undefined) {
            this.broadcastChannel?.postMessage(ev);
        } else {
            for (const dispatcher of DefaultTriggerDispatcher.channels.get(this.channelName())) {
                dispatcher(ev);
            }
        }
    }

    private channelName() {
        return 'trigger::' + this.backendName + '/' + this.dbName;
    }
    
}

export { DefaultTriggerDispatcher };