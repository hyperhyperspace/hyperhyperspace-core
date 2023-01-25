import { MultiMap } from 'util/multimap';
import { HashedObject, MutableObject, MutationOp } from '../model';


class HistoryLog extends MutableObject {

    static className = 'hhs/v0/HistoryLog';

    entriesPerBook?: number;
    transitionRequestMaxAge?: number; // in # of entries

    constructor() {
        super([]);
    }

    mutate(op: MutationOp, valid: boolean, cascade: boolean): Promise<boolean> {
        op; valid; cascade;
        throw new Error('Method not implemented.');
    }

    getMutableContents(): MultiMap<string, HashedObject> {
        throw new Error('Method not implemented.');
    }

    getMutableContentByHash(hash: string): Set<HashedObject> {
        hash;
        throw new Error('Method not implemented.');
    }

    getClassName(): string {
        throw new Error('Method not implemented.');
    }

    init(): void {
        throw new Error('Method not implemented.');
    }

    validate(references: Map<string, HashedObject>): Promise<boolean> {
        references;
        throw new Error('Method not implemented.');
    }

}

export { HistoryLog };