import { HashedObject } from 'data/model';
import { Observer, Event, location } from 'util/events';

type MutatedField    = location<HashedObject>
type MutatedPath     = MutatedField[];

type MutationEvent    = Event<HashedObject>;
type MutationObserver = Observer<HashedObject>;

type MatchResult = { matched: boolean, matchCount: number };

interface MutatedPathFilter {
    
    match(path: MutatedPath, skip?: number): MatchResult;

    repeat(params?: RepeatPathFilterParams): MutatedPathFilter;
    then(filter: MutatedPathFilter): MutatedPathFilter;
    end(): MutatedPathFilter;
};

abstract class MutatedPathFilterBase {

    abstract match(path: MutatedPath, skip?: number): MatchResult;

    repeat(params?: RepeatPathFilterParams): MutatedPathFilter {
        return new RepeatPathFilter(this, params);
    }

    then(filter: MutatedPathFilter): MutatedPathFilter {
        return new ConcatPathFilters(this, filter);
    }

    end(): MutatedPathFilter {
        return new FinalPathFilter(this);
    }

}

type RepeatPathFilterParams = {minTimes?: number, maxTimes?: number, greedy?: boolean};
class RepeatPathFilter extends MutatedPathFilterBase implements MutatedPathFilter {
    
    pathFilter: MutatedPathFilter;

    minTimes: number;
    maxTimes?: number;
    greedy: boolean;

    constructor(pathFilter: MutatedPathFilter, params?: RepeatPathFilterParams) {
        super();

        this.pathFilter = pathFilter;
        this.minTimes   = params?.minTimes || 0;
        this.maxTimes   = params?.maxTimes;
        this.greedy     = true;

        if (params?.greedy !== undefined) {
            this.greedy = params?.greedy;
        }
    }

    match(path: MutatedPath, skip=0): { matched: boolean, matchCount: number } {

        const oldSkip = skip;
        let matched = this.minTimes === 0;
        let count = 0;

        while ((!matched || this.greedy) && (this.maxTimes === undefined || count < this.maxTimes)) {

            if (path.length === skip) {
                break;
            }

            const m = this.pathFilter.match(path, skip);

            if (m.matched === false) {
                break;
            }

            skip = skip + m.matchCount;
            count = count + 1;
            matched = count >= this.minTimes;
        }

        return { matched: matched, matchCount: skip-oldSkip };
    }
}

class ConcatPathFilters extends MutatedPathFilterBase implements MutatedPathFilter {

    first: MutatedPathFilter;
    second: MutatedPathFilter;

    constructor(first: MutatedPathFilter, second: MutatedPathFilter) {
        super();
        this.first = first;
        this.second = second;
    }

    match(path: MutatedPath, skip=0): MatchResult {

        const firstMatch = this.first.match(path, skip);

        if (firstMatch.matched) {
            const secondMatch = this.second.match(path, skip + firstMatch.matchCount);
            if (secondMatch.matched) {
                return { matched: true, matchCount: firstMatch.matchCount + secondMatch.matchCount };
            }
        }

        return { matched: false, matchCount: 0 };
    }

}

class FinalPathFilter extends MutatedPathFilterBase implements MutatedPathFilter {

    filter: MutatedPathFilter;

    constructor(filter: MutatedPathFilter) {
        super();

        this.filter = filter;
    }

    match(path: MutatedPath, skip=0): MatchResult {

        let m = this.filter.match(path, skip);

        if (!m.matched || skip + m.matchCount < path.length) {
            return { matched: false, matchCount: 0 };
        }

        return { matched: true, matchCount: path.length - skip };
    }

}

class MutatedFieldFilter extends MutatedPathFilterBase implements MutatedPathFilter {

    className?: string;
    fieldName?: string;
    filter?: (m: MutatedField) => boolean;

    constructor(init: {className?: string, fieldName?: string, filter?: (m: MutatedField) => boolean}) {
        super();

        this.className = init.className;
        this.fieldName = init.fieldName;
        this.filter    = init.filter;
    }

    match(path: MutatedPath, skip=0): MatchResult {

        const noMatch = { matched: false, matchCount: 0 };

        if (skip >= path.length) {
            return noMatch;
        }

        const mutatedField = path[skip];

        if (this.className !== undefined && mutatedField.emitter.getClassName() !== this.className) {
            return noMatch;
        }

        if (this.fieldName !== undefined && mutatedField.name !== this.fieldName) {
            return noMatch;
        }

        if (this.filter !== undefined && !this.filter(mutatedField)) {
            return noMatch;
        }

        return { matched: true, matchCount: 1 };
    }
}


type MutationEventFilterParameters = {
    mutatedPathFilter?: MutatedPathFilter,
    action?: string,
    actions?: Array<string>,
    className?: string,
    classNames?: string
};

class MutationEventFilter {

    mutatedPathFilter?: MutatedPathFilter;
    action?: string;
    actions?: Array<string>;
    className?: string;
    classNames?: string;

    constructor(params?: MutationEventFilterParameters) {

        this.mutatedPathFilter = params?.mutatedPathFilter;
        this.action            = params?.action;
        this.actions           = params?.actions;
        this.className         = params?.className;
        this.classNames        = params?.classNames;

    }

    accept(ev: Event<HashedObject>): boolean {

        const path = ev.path || [];

        if (this.mutatedPathFilter !== undefined && !this.mutatedPathFilter.match(path).matched) {
            return false;
        }

        if (this.action !== undefined && this.action !== ev.action) {
            return false;
        }

        if (this.actions !== undefined && this.actions.indexOf(ev.action) < 0) {
            return false;
        }

        if (this.className !== undefined && this.className !== ev.emitter.getClassName()) {
            return false;
        }

        if (this.classNames !== undefined && this.classNames.indexOf(ev.emitter.getClassName()) < 0) {
            return false;
        }
        
        return true;
    }
}

class MutationEvents {

    // counting in hops from the origin emitter (idx==0 is the original one, -1 is the closest to it, etc.)
    static getRelayEmitterByIdx<T extends HashedObject> (ev: MutationEvent, idx?: number): T|undefined {

        if (idx === undefined) {
            return undefined;
        }

        if (idx === 0) {
            return ev.emitter as T;
        } else {
            if (ev.path === undefined || ev.path.length < idx) {
                return undefined;
            } else {
                return ev.path[ev.path.length - idx].emitter as T;
            }
        }
    }
}

export { MutationEvent, MutationObserver, MutationEventFilter, MutatedPathFilter, MutatedFieldFilter, MutationEvents };