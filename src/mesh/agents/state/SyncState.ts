import { Hash } from 'data/model';

type SyncState = {
    objectHash: Hash,

    fetchedEverything: boolean, // all remote known ops have been fetched
    sentEverything: boolean,    // all local ops have been sent to all current peers
    synchronzing: boolean,      // ops are being exchanged at the moment

    opsToReceive: number        // how many ops we know we need to fetch
};

export type { SyncState };