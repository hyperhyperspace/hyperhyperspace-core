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
type hashable = { getLastHash(): hash; };

type location<T> = {name: string, emitter: T};
//type path<T> = Array<location<T>>;

type Event<E extends hashable, D=any> = {
    emitter: E;
    path?: location<E>[];
    action: string;
    data: D;
}

type EventCallback<E extends hashable, D=any> = (ev: Event<E, D>) => boolean|void;

type Observer<E extends hashable, D=any> = EventCallback<E, D>;

class EventRelay<E extends hashable, D=any> {
    
    static logger = new Logger('event-relay', LogLevel.INFO);

    emitter: E;
    upstreamRelays: Map<string, [EventRelay<E, D>, Observer<E, D>]>;

    observers: Set<Observer<E, D>>;
    donwstreamObservers: Set<Observer<E, D>>;
    

    constructor(source: E, upstreamRelays?: Map<string, EventRelay<E, D>>) {

        this.emitter     = source;

        this.upstreamRelays = new Map();

        if (upstreamRelays !== undefined) {
            for (const [field, upstreamSource] of upstreamRelays.entries()) {
                this.addUpstreamRelay(field, upstreamSource);
            }
        }

        this.observers = new Set();
        this.donwstreamObservers = new Set();

    }

    addObserver(obs: Observer<E, D>) {
        this.observers.add(obs);
    }

    removeObserver(obs: Observer<E, D>) {
        this.observers.delete(obs);
    }

    addDownstreamObserver(obs: Observer<E, D>) {
        this.donwstreamObservers.add(obs);
    }

    removeDownstreamObserver(obs: Observer<E, D>) {
        this.donwstreamObservers.delete(obs);
    }

    addUpstreamRelay(name: string, upstream: EventRelay<E, D>) {

        EventRelay.logger.debug('adding upstream ' + name + ' (' + upstream.emitter.getLastHash() + ') to ' + this.emitter.getLastHash());

        if (!upstream.wouldCreateACycle(this.emitter.getLastHash())) {

            const observer = (upstreamEv: Event<E, D>) => {

                // if the original emitter and the current emitter are the same,it means that the event has
                // somehow propagated back to its origin, we do not need to forward the event any more
                if (upstreamEv.emitter.getLastHash() !== this.emitter.getLastHash()) {

                    const upstreamEmitters = upstreamEv.path === undefined? [] : Array.from(upstreamEv.path)

                    upstreamEmitters.push({name: name, emitter: this.emitter});
    
                    const ev: Event<E, D> = {
                        emitter: upstreamEv.emitter,
                        path: upstreamEmitters,
                        action: upstreamEv.action,
                        data: upstreamEv.data                
                    };
    
                    EventRelay.logger.debug('upstream from ' + this.emitter.getLastHash() + ' name: ' + name);
    
                    this.emit(ev);
                }

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

    removeAllUpstreamRelays() {
        for (const name of Array.from(this.upstreamRelays.keys())) {
            this.removeUpstreamRelay(name);
        }
    }

    hasUpstreamRelay(name: string) {
        return this.upstreamRelays.has(name);
    }

    private wouldCreateACycle(emitterHash: hash) {

        if (this.emitter.getLastHash() === emitterHash) {
            return true;
        }

        for (const [upstream, _observer] of this.upstreamRelays.values()) {
            if (upstream.wouldCreateACycle(emitterHash)) {
                return true;
            }
        }

        return false;

    }

    emit(ev: Event<E, D>) {
 
        EventRelay.logger.debug('emitting from ' + this.emitter.getLastHash());
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