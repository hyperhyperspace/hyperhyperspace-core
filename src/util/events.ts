type hash = string;
type hashable = { hash(): hash; };

type location<T> = {name: string, emitter: T};
//type path<T> = Array<location<T>>;

type Event<T extends hashable> = {
    emitter: T;
    path?: location<T>[];
    action: string;
    data: any;
}

type EventCallback<T extends hashable> = (ev: Event<T>) => void;


interface EventFilter<T extends hashable> {

    accept(ev: Event<T>): boolean;
}

type Observer<T extends hashable> = { filter?: EventFilter<T>, callback: EventCallback<T> };

class EventRelay<T extends hashable> {

    emitter: T;
    emitterHash: hash;
    upstreamRelays: Map<string, [EventRelay<T>, Observer<T>]>;

    observers: Set<Observer<T>>;
    

    constructor(source: T, upstreamRelays: Map<string, EventRelay<T>>) {

        this.emitter     = source;
        this.emitterHash = source.hash(); 

        this.upstreamRelays = new Map();

        for (const [field, upstreamSource] of upstreamRelays.entries()) {
            this.addUpstreamRelay(field, upstreamSource);
        }

        this.observers = new Set();

    }

    addObserver(obs: Observer<T>) {
        this.observers.add(obs);
    }

    removeObserver(obs: Observer<T>) {
        this.observers.delete(obs);
    }

    addUpstreamRelay(name: string, upstream: EventRelay<T>) {

        if (!this.wouldCreateACycle(upstream.emitterHash)) {
            
            this.upstreamRelays.set(name, [upstream, { callback: (upstreamEv: Event<T>) => {

                const upstreamEmitters = upstreamEv.path === undefined? [] : Array.from(upstreamEv.path)

                upstreamEmitters.push({name: name, emitter: this.emitter});

                const ev: Event<T> = {
                    emitter: upstreamEv.emitter,
                    path: upstreamEmitters,
                    action: upstreamEv.action,
                    data: upstreamEv.data                
                };

                this.emit(ev);

            }}]);
        }
    }

    removeUpstreamRelay(name: string) {
        this.upstreamRelays.delete(name);
    }

    hasUpstreamRelay(name: string) {
        return this.upstreamRelays.has(name);
    }

    private wouldCreateACycle(emitterHash: hash) {

        if (this.emitterHash === emitterHash) {
            return true;
        }

        for (const [source, _observer] of this.upstreamRelays.values()) {
            if (source.wouldCreateACycle(emitterHash)) {
                return true;
            }
        }

        return false;

    }

    emit(ev: Event<T>) {
        for (const obs of this.observers) {
            if (obs.filter === undefined || obs.filter.accept(ev)) {
                obs.callback(ev);
            }
        }
    }
}

export { Event, EventRelay, EventCallback, EventFilter, Observer, location, hashable }