import { RNGImpl } from 'crypto/random';
import { Literal } from 'data/model';
import { Store } from 'storage/store/Store';
import { Backend } from './Backend';
import { IdbBackend } from './IdbBackend';


class WorkerSafeIdbBackend extends IdbBackend implements Backend {

    static backendName = 'worker-safe-idb';

    static channelName = 'idb-backend-trigger';
    static broadcastId: string;
    static broadcastChannel: BroadcastChannel;

    static init(): void {
        if (WorkerSafeIdbBackend.broadcastId === undefined) {
            
            WorkerSafeIdbBackend.broadcastId = new RNGImpl().randomHexString(128);
            WorkerSafeIdbBackend.broadcastChannel = new BroadcastChannel(WorkerSafeIdbBackend.channelName);
            console.log('initializing for ' + WorkerSafeIdbBackend.broadcastId);
            WorkerSafeIdbBackend.broadcastChannel.onmessage = (ev: MessageEvent<any>) => {
                
                console.log('got data');
                console.log(ev.data);
                if (ev.data.broadcastId !== undefined &&
                    ev.data.broadcastId !== WorkerSafeIdbBackend.broadcastId) {

                    console.log('firing callbacks for ' + ev.data.literal.hash + ' in ' + WorkerSafeIdbBackend.broadcastId);
                    try {
                        IdbBackend.fireCallbacks(ev.data.dbName, ev.data.literal);
                    } catch (e) {
                        console.log('ERROR');
                        console.log(e);
                    }
                    
                
                }
            };
        }
    }

    constructor(name: string) {
        super(name);

        console.log('constructing for ' + name);

        WorkerSafeIdbBackend.init();
    }

    getBackendName() {
        return WorkerSafeIdbBackend.backendName;
    }

    async store(literal: Literal): Promise<void> {
        await super.store(literal);

        console.log('super name is ' + this.name);

        WorkerSafeIdbBackend.broadcastChannel.postMessage({
            broadcastId: WorkerSafeIdbBackend.broadcastId,
            dbName: this.name,
            literal: literal
        });
    }
    
}

Store.registerBackend(WorkerSafeIdbBackend.backendName, (dbName: string) => new WorkerSafeIdbBackend(dbName));


export { WorkerSafeIdbBackend };