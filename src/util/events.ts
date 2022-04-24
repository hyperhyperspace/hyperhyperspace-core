import { Logger, LogLevel } from 'util/logging';

/* EventRelays can emit events, and have other EventRelays upstream and downstream of them.
 * 
 * Users of event relays can attach observers, and emit events on EventRelays. Observers can
 * accept or reject events. When an event is emitted, it is sent downstream until it is
 * accepted. Observers accept an event by returning true. When an event reachs a relay, all
 * its observers all invoked (even if some of them return true). When none do, the event is sent
 * to all the downstream relays.
 * 
 * One relay is attached upstream of another through a 'location', a record that contains the
 * emitter relay and a 'name' (a string). Thus as an event is relayed, a path of pairs
 * (emitter, name) is formed.
 */


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

type EventCallback<T extends hashable> = (ev: Event<T>) => boolean|void;

type Observer<T extends hashable> = EventCallback<T>;

class EventRelay<T extends hashable> {
    
    static logger = new Logger('event-relay', LogLevel.INFO);

    emitter: T;
    emitterHash: hash;
    upstreamRelays: Map<string, [EventRelay<T>, Observer<T>]>;

    observers: Set<Observer<T>>;
    donwstreamObservers: Set<Observer<T>>;
    

    constructor(source: T, upstreamRelays: Map<string, EventRelay<T>>) {

        this.emitter     = source;
        this.emitterHash = source.hash(); 

        this.upstreamRelays = new Map();

        for (const [field, upstreamSource] of upstreamRelays.entries()) {
            this.addUpstreamRelay(field, upstreamSource);
        }

        this.observers = new Set();
        this.donwstreamObservers = new Set();

    }

    addObserver(obs: Observer<T>) {
        this.observers.add(obs);
    }

    removeObserver(obs: Observer<T>) {
        this.observers.delete(obs);
    }

    addDownstreamObserver(obs: Observer<T>) {
        this.donwstreamObservers.add(obs);
    }

    removeDownstreamObserver(obs: Observer<T>) {
        this.donwstreamObservers.delete(obs);
    }

    addUpstreamRelay(name: string, upstream: EventRelay<T>) {

        EventRelay.logger.debug('adding upstream ' + name + ' (' + upstream.emitterHash + ') to ' + this.emitterHash);

        //if (!this.wouldCreateACycle(upstream.emitterHash)) {
        if (!upstream.wouldCreateACycle(this.emitterHash)) {

            const observer = (upstreamEv: Event<T>) => {

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

                return false;

            };
            
            this.upstreamRelays.set(name, [upstream, observer]);

            upstream.addDownstreamObserver(observer);
        } else {
            EventRelay.logger.debug('ooops.... cycle detected! skipping');
        }
    }

    removeUpstreamRelay(name: string) {

        const existing = this.upstreamRelays.get(name);

        if (existing !== undefined) {

            const [upstream, observer] = existing;

            upstream.removeDownstreamObserver(observer);

            this.upstreamRelays.delete(name);
        }

        
    }

    hasUpstreamRelay(name: string) {
        return this.upstreamRelays.has(name);
    }

    private wouldCreateACycle(emitterHash: hash) {

        if (this.emitterHash === emitterHash) {
            console.log('clash: ' + this.emitterHash);
            return true;
        }

        for (const [upstream, _observer] of this.upstreamRelays.values()) {
            if (upstream.wouldCreateACycle(emitterHash)) {
                console.log('clash path: ' + upstream.emitterHash);
                return true;
            }
        }

        return false;

    }

    emit(ev: Event<T>) {
 
        EventRelay.logger.debug('emitting from ' + this.emitterHash);
        EventRelay.logger.trace('event is:', ev);
        EventRelay.logger.trace('got ' + this.observers.size + ' observers');

        let accepted = false;

        for (const obs of this.observers) {
            const acceptedByObs = obs(ev);
            accepted = accepted || (acceptedByObs !== undefined && acceptedByObs);
        }

        if (!accepted) {

            EventRelay.logger.debug('not accepted, cascading...');

            for (const obs of this.donwstreamObservers) {
                obs(ev);
            }
        }
    }
}

export { Event, EventRelay, EventCallback, Observer, location, hashable }