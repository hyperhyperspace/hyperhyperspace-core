import { Logger } from 'util/logging';

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
    
    static logger = new Logger('event-relay');

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

        EventRelay.logger.debug('adding upsteram ' + name + ' (' + upstream.emitterHash + ') to ' + this.emitterHash);

        if (!this.wouldCreateACycle(upstream.emitterHash)) {

            const observer = { callback: (upstreamEv: Event<T>) => {

                const upstreamEmitters = upstreamEv.path === undefined? [] : Array.from(upstreamEv.path)

                upstreamEmitters.push({name: name, emitter: this.emitter});

                const ev: Event<T> = {
                    emitter: upstreamEv.emitter,
                    path: upstreamEmitters,
                    action: upstreamEv.action,
                    data: upstreamEv.data                
                };

                EventRelay.logger.debug('upstream from ' + this.emitterHash + ' name: ' + name);

                this.emit(ev);

            }};
            
            this.upstreamRelays.set(name, [upstream, observer]);

            upstream.addObserver(observer);
        } else {
            EventRelay.logger.debug('ooops.... cycle detected!');
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
 
        EventRelay.logger.debug('emitting from ' + this.emitterHash);
        EventRelay.logger.trace(ev);
        EventRelay.logger.trace('got ' + this.observers.size + ' observers');

        for (const obs of this.observers) {
            if (obs.filter === undefined || obs.filter.accept(ev)) {

                obs.callback(ev);
            } else {
                EventRelay.logger.trace('failed filter!');
            }
        }
    }
}

export { Event, EventRelay, EventCallback, EventFilter, Observer, location, hashable }