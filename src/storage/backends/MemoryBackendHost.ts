import { RNGImpl } from 'crypto/random';

import { Literal } from 'data/model/literals/LiteralUtils';
import { Hash } from 'data/model/hashing/Hashing';


import { StoredOpHeader } from '../store';
import { StateCheckpoint } from 'data/model';

import { MemoryBackend } from './MemoryBackend';
import { BackendSearchParams } from './Backend';
import { MemoryBackendProxy } from './MemoryBackendProxy';

type BackendCmd = ReadyCmd | StoreCmd | LoadCmd | StoreCheckpointCmd | LoadLastCheckpointCmd | LoadLastCheckpointMetaCmd |
                  LoadOpHeaderCmd | LoadOpHeaderByHeaderHashCmd | LoadTerminalOpsForMutableCmd |
                  SearchByClassCmd | SearchByReferenceCmd | SearchByReferencingClassCmd;

type ReadyCmd = {
    type: 'ready',
    requestId: string
}

type StoreCmd = {
    type: 'store',
    requestId: string,
    literal: Literal,
    history?: StoredOpHeader
};

type LoadCmd = {
    type: 'load',
    requestId: string,
    hash: Hash
};

type StoreCheckpointCmd = {
    type: 'store-checkpoint',
    requestId: string,
    checkpoint: StateCheckpoint
};

type LoadLastCheckpointCmd = {
    type: 'load-last-checkpoint',
    requestId: string,
    mut: Hash
};

type LoadLastCheckpointMetaCmd = {
    type: 'load-last-checkpoint-meta',
    requestId: string,
    mut: Hash
};

type LoadOpHeaderCmd = {
    type: 'load-op-header',
    requestId: string,
    opHash: Hash
};

type LoadOpHeaderByHeaderHashCmd = {
    type: 'load-op-header-by-header-hash',
    requestId: string,
    opHeaderHash: Hash
};

type LoadTerminalOpsForMutableCmd = {
    type: 'load-terminal-ops',
    requestId: string,
    mut: Hash
};

type SearchByClassCmd = {
    type: 'search-by-class',
    requestId: string,
    className: string,
    params?: BackendSearchParams
};

type SearchByReferenceCmd = {
    type: 'search-by-reference',
    requestId: string,
    referringPath: string,
    referencedHash: Hash,
    params?: BackendSearchParams
};

type SearchByReferencingClassCmd = {
    type: 'search-by-referencing-class',
    requestId: string,
    referringClassName: string,
    referringPath: string,
    referencedHash: Hash,
    params?: BackendSearchParams
};

type CommandReply = {
    type: 'reply',
    requestId: string,
    result?: any,
    error?: any
};

type StoredObjectMessage = {
    type: 'stored-object-message',
    literal: Literal
};

class MemoryBackendHost {

    // A MemoryBackend that works in a web worker and is accessed through a proxy
    // using BroadcastChannels.

    static environmentId?: string = undefined;

    static getEnviromentId = () => {
        if (MemoryBackendHost.environmentId === undefined) {
            MemoryBackendHost.environmentId = new RNGImpl().randomHexString(128);
        }

        return MemoryBackendHost.environmentId;
    };

    static getStoredObjectCallbackChannelName(dbName: string, environmentId?: string) {

        if (environmentId === undefined) {
            environmentId = MemoryBackendHost.getEnviromentId()
        }

        return 'memory-store-callback/' + environmentId + '/' + dbName;
    }

    static getCommandChannelName(dbName: string, environmentId?: string) {
        
        if (environmentId === undefined) {
            environmentId = MemoryBackendHost.getEnviromentId()
        }

        return 'memory-store-commands/' + environmentId + '/' + dbName;
    }

    backend: MemoryBackend;

    storedObjectCallbackChannel : BroadcastChannel;
    commandChannel              : BroadcastChannel;

    constructor(dbName: string) {

        this.backend = new MemoryBackend(dbName);

        this.backend.setStoredObjectCallback(async (literal: Literal) => {

            const msg: StoredObjectMessage = {
                type: 'stored-object-message',
                literal: literal
            }

            this.storedObjectCallbackChannel.postMessage(msg);
        });

        const storedObjectCallbackChannelName = MemoryBackendHost.getStoredObjectCallbackChannelName(dbName);
        this.storedObjectCallbackChannel      = new BroadcastChannel(storedObjectCallbackChannelName);

        const commandChannelName = MemoryBackendHost.getCommandChannelName(dbName);
        this.commandChannel      = new BroadcastChannel(commandChannelName);

        this.commandChannel.onmessage = async (ev: MessageEvent<BackendCmd>) => {

            if (ev.data.type === 'store') {
                const stored = this.backend.store(ev.data.literal, ev.data.history);
                this.sendReply(ev.data.requestId, stored);
            } else if (ev.data.type === 'load') {
                const loaded = this.backend.load(ev.data.hash);
                this.sendReply(ev.data.requestId, loaded);
            } else if (ev.data.type === 'store-checkpoint') {
                const stored = this.backend.storeCheckpoint(ev.data.checkpoint);
                this.sendReply(ev.data.requestId, stored);
            } else if (ev.data.type === 'load-last-checkpoint') {
                const last = this.backend.loadLastCheckpoint(ev.data.mut);
                this.sendReply(ev.data.requestId, last);
            } else if (ev.data.type === 'load-last-checkpoint-meta') {
                const lastMeta = this.backend.loadLastCheckpointMeta(ev.data.mut);
                this.sendReply(ev.data.requestId, lastMeta);
            } else if (ev.data.type === 'load-op-header') {
                const loaded = this.backend.loadOpHeader(ev.data.opHash);
                this.sendReply(ev.data.requestId, loaded);
            } else if (ev.data.type === 'load-op-header-by-header-hash') {
                const loaded = this.backend.loadOpHeaderByHeaderHash(ev.data.opHeaderHash);
                this.sendReply(ev.data.requestId, loaded);
            } else if (ev.data.type === 'load-terminal-ops') {
                const loaded = this.backend.loadTerminalOpsForMutable(ev.data.mut);
                this.sendReply(ev.data.requestId, loaded);
            } else if (ev.data.type === 'search-by-class') {
                const results = this.backend.searchByClass(ev.data.className, ev.data.params);
                this.sendReply(ev.data.requestId, results);
            } else if (ev.data.type === 'search-by-reference') {
                const results = this.backend.searchByReference(ev.data.referringPath, ev.data.referencedHash, ev.data.params);
                this.sendReply(ev.data.requestId, results);
            } else if (ev.data.type === 'search-by-referencing-class') {
                const results = this.backend.searchByReferencingClass(ev.data.referringClassName, ev.data.referringPath, ev.data.referencedHash, ev.data.params);
                this.sendReply(ev.data.requestId, results);
            }

        };

    }

    private async sendReply(requestId: string, promise: Promise<any>) {

        try {
            const result = await promise;
            this.commandChannel.postMessage({type: 'reply', requestId: requestId, result: result} as CommandReply);
        } catch (e: any) {

            let reason = e.message;

            if (typeof(reason) !== 'string') {
                try {
                    reason = e.toString();
                } catch {
                    reason = "Memory backend host: error information is unavailable.";
                }   
            }

            this.commandChannel.postMessage({type: 'reply', requestId: requestId, reason: reason} as CommandReply);
        }
    }

    getProxy(): MemoryBackendProxy {

        const proxy = new MemoryBackendProxy(this.backend.getName(), MemoryBackendHost.getEnviromentId());
        proxy.host = this;

        return proxy;
    }
}

export { MemoryBackendHost, BackendCmd, ReadyCmd, StoreCmd, LoadCmd, StoreCheckpointCmd, LoadLastCheckpointCmd,
        LoadLastCheckpointMetaCmd, LoadOpHeaderCmd, LoadOpHeaderByHeaderHashCmd, 
        LoadTerminalOpsForMutableCmd, SearchByClassCmd, SearchByReferenceCmd, 
        SearchByReferencingClassCmd, CommandReply, StoredObjectMessage };