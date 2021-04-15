import { BroadcastChannel as PhonyChannel } from 'broadcast-channel';


let SafeBroadcastChannel = window?.BroadcastChannel;

if (SafeBroadcastChannel === undefined) {
    SafeBroadcastChannel = self?.BroadcastChannel;
}


class BroadcastChannelPolyfill {

    channel: PhonyChannel;
    closed: boolean;

    readonly name: string;
    onmessage: ((this: BroadcastChannel|BroadcastChannelPolyfill, ev: MessageEvent) => any) | null;
    onmessageerror: ((this: BroadcastChannel|BroadcastChannelPolyfill, ev: MessageEvent) => any) | null;

    
    //removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;


    constructor(name: string) {

        this.closed = false;
        this.channel = new PhonyChannel(name);

        this.channel.onmessage = (msg: any) => {
            if (this.onmessage !== null) {
                this.onmessage(msg);
            }
        };
        
        this.name = name;
        this.onmessage = null;
        this.onmessageerror = null;
    }

    /**
     * Closes the BroadcastChannel object, opening it up to garbage collection.
     */
     close(): void {
        this.closed = true;
        this.channel.close();
    }
    /**
     * Sends the given message to other BroadcastChannel objects set up for this channel. Messages can be structured objects, e.g. nested objects and arrays.
     */
    postMessage(message: any): void {
        this.channel.postMessage({data: message});
    }

    addEventListener<K extends keyof BroadcastChannelEventMap>(_type: K, _listener: (this: BroadcastChannel, ev: BroadcastChannelEventMap[K]) => any, _options?: boolean | AddEventListenerOptions): void {
        throw new Error('BroadcastChannel.addEventListener is not supported in this platform');
    }

   
    removeEventListener<K extends keyof BroadcastChannelEventMap>(_type: K, _listener: (this: BroadcastChannel, ev: BroadcastChannelEventMap[K]) => any, _options?: boolean | EventListenerOptions): void {
        throw new Error('BroadcastChannel.addEventListener is not supported in this platform');
    }
}

if (SafeBroadcastChannel === undefined) {

    SafeBroadcastChannel = BroadcastChannelPolyfill as any;

}


export { SafeBroadcastChannel };