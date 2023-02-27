import { RNGImpl } from 'crypto/random';
import { Hash, Literal, StateCheckpoint } from 'data/model';
import { Store, StoredOpHeader } from 'storage/store';
import { Backend, BackendSearchParams, BackendSearchResults, Storable } from './Backend';
import { MemoryBackend } from './MemoryBackend';

import { MemoryBackendHost, BackendCmd, ReadyCmd, StoreCmd, LoadCmd, StoreCheckpointCmd, LoadLastCheckpointCmd,
    LoadLastCheckpointMetaCmd, LoadOpHeaderCmd, LoadOpHeaderByHeaderHashCmd, 
    LoadTerminalOpsForMutableCmd, SearchByClassCmd, SearchByReferenceCmd, 
    SearchByReferencingClassCmd, StoredObjectMessage, CommandReply } from './MemoryBackendHost';


const REQ_ID_BITS = 128;

class MemoryBackendProxy implements Backend {

    static backendName = 'memory-broadcastchannel-proxy';


    // A proxy that gives access to a MemoryBackend using BroadcastChannels

    // Since usually these will be used in the context of a browser tab, to provide
    // transient storage for temprary spaces, but BroadcastChannels work globally,
    // we'll generate an "environmentId" that helps all the proxies generated in
    // a given environment (e.g. a browser tab) have the same lifecycle. The broadcast
    // channel will be used only when accessing stores created in other environments.

    dbName: string;
    enviromentId: string;

    backend?: MemoryBackend;

    storedObjectCallbackChannel? : BroadcastChannel;
    commandChannel?              : BroadcastChannel

    storedObjectCallback?: (literal: Literal) => Promise<void>;

    pendingReplies:  Map<string, {resolve: (value: any) => void, reject: (reason?: any) => void}>;

    commandTimeout = 10000;

    host?: MemoryBackendHost;

    constructor(dbName: string, environmentId: string) {

        this.dbName = dbName;
        this.enviromentId = environmentId;
        
        if (MemoryBackendHost.getEnviromentId() === environmentId) {
            this.backend = new MemoryBackend(dbName);
        } else {
            const storedObjectCallbackChannelName = MemoryBackendHost.getStoredObjectCallbackChannelName(dbName, environmentId);
            this.storedObjectCallbackChannel      = new BroadcastChannel(storedObjectCallbackChannelName);

            this.storedObjectCallbackChannel.onmessage = (ev: MessageEvent<any>) => {
                if (ev.data.type === 'stored-object-message') {
                    const storedObjectMsg = ev.data as StoredObjectMessage;

                    if (this.storedObjectCallback !== undefined) {
                        this.storedObjectCallback(storedObjectMsg.literal);
                    }
                }
            }

            const commandChannelName = MemoryBackendHost.getCommandChannelName(dbName, environmentId);
            this.commandChannel      = new BroadcastChannel(commandChannelName);

            this.commandChannel.onmessage = (ev: MessageEvent<any>) => {
                if (ev.data.type === 'reply') {
                    const reply = ev.data as CommandReply;

                    const executor = this.pendingReplies.get(reply.requestId);

                    if (executor !== undefined) {

                        this.pendingReplies.delete(reply.requestId);

                        if (reply.error === undefined) {
                            executor.resolve(reply.result);
                        } else {
                            executor.reject(reply.error);
                        }
                    }
                }
            }
        }

        this.pendingReplies = new Map();

    }


    getBackendName(): string {
        return MemoryBackendProxy.backendName;
    }

    getName(): string {
        return this.dbName;
    }

    getURL() {
        return MemoryBackendProxy.backendName + '://' + this.enviromentId + '/' + this.dbName;
    }

    private registerPendingReply(requestId: string, executor: {resolve: (value?: any) => void, reject: (reason?: any) => void}) {
        this.pendingReplies.set(requestId, executor);   
    }

    private createCommandPromise(cmd: BackendCmd): Promise<any> {

        let result = new Promise<any>((resolve: (value: any) => void, reject: (reason?: any) => void) => {
            this.registerPendingReply(cmd.requestId, {resolve: resolve, reject: reject});
        });
        
        setTimeout(() => {
            const executor = this.pendingReplies.get(cmd.requestId);

            if (executor !== undefined) {
                this.pendingReplies.delete(cmd.requestId);

                executor.reject('timeout');
            }

        }, this.commandTimeout);

        this.commandChannel?.postMessage(cmd);

        return result;
    }

    ready(): Promise<void> {
        if (this.backend !== undefined) {
            return Promise.resolve();
        } else if (this.commandChannel !== undefined) {
            const cmd: ReadyCmd = {
                type: 'ready',
                requestId: new RNGImpl().randomHexString(REQ_ID_BITS)
            };

            return this.createCommandPromise(cmd);
        } else {
            return Promise.reject('Unexpected error: memory backend proxy is uninitialized (maybe it was closed?)');
        }
    }

    store(literal: Literal, history?: StoredOpHeader | undefined): Promise<void> {
        
        if (this.backend !== undefined) {
            return this.backend.store(literal, history);
        } else if (this.commandChannel !== undefined) {
            const cmd: StoreCmd = {
                type: 'store',
                requestId: new RNGImpl().randomHexString(REQ_ID_BITS),
                literal: literal,
                history: history
            };

            return this.createCommandPromise(cmd);
        } else {
            return Promise.reject('Unexpected error: memory backend proxy is uninitialized (maybe it was closed?)');
        }
    }

    load(hash: Hash): Promise<Storable | undefined> {

        if (this.backend !== undefined) {
            return this.backend.load(hash);
        } else if (this.commandChannel !== undefined) {
            const cmd: LoadCmd = {
                type: 'load',
                requestId: new RNGImpl().randomHexString(REQ_ID_BITS),
                hash: hash
            };

            return this.createCommandPromise(cmd);
        } else {
            return Promise.reject('Unexpected error: memory backend proxy is uninitialized (maybe it was closed?)');
        }
    }

    storeCheckpoint(checkpoint: StateCheckpoint): Promise<void> {

        if (this.backend !== undefined) {
            return this.backend.storeCheckpoint(checkpoint);
        } else if (this.commandChannel !== undefined) {
            const cmd: StoreCheckpointCmd = {
                type: 'store-checkpoint',
                requestId: new RNGImpl().randomHexString(REQ_ID_BITS),
                checkpoint: checkpoint
            };

            return this.createCommandPromise(cmd);
        } else {
            return Promise.reject('Unexpected error: memory backend proxy is uninitialized (maybe it was closed?)');
        }
    }

    loadLastCheckpoint(mutableObject: Hash): Promise<StateCheckpoint | undefined> {

        if (this.backend !== undefined) {
            return this.backend.loadLastCheckpoint(mutableObject)
        } else if (this.commandChannel !== undefined) {
            const cmd : LoadLastCheckpointCmd = {
                type: 'load-last-checkpoint',
                requestId: new RNGImpl().randomHexString(REQ_ID_BITS),
                mut: mutableObject
            };

            return this.createCommandPromise(cmd);
        } else {
            return Promise.reject('Unexpected error: memory backend proxy is uninitialized (maybe it was closed?)');
        }
    }

    loadLastCheckpointMeta(mutableObject: Hash): Promise<StateCheckpoint | undefined> {
        
        if (this.backend !== undefined) {
            return this.backend.loadLastCheckpointMeta(mutableObject);
        } else if (this.commandChannel !== undefined) {
            const cmd: LoadLastCheckpointMetaCmd = {
                type: 'load-last-checkpoint-meta',
                requestId: new RNGImpl().randomHexString(REQ_ID_BITS),
                mut: mutableObject
            };

            return this.createCommandPromise(cmd);
        } else {
            return Promise.reject('Unexpected error: memory backend proxy is uninitialized (maybe it was closed?)');
        }
    }

    loadOpHeader(opHash: string): Promise<StoredOpHeader | undefined> {
        
        if (this.backend !== undefined) {
            return this.backend.loadOpHeader(opHash);
        } else if (this.commandChannel !== undefined) {
            const cmd: LoadOpHeaderCmd = {
                type: 'load-op-header',
                requestId: new RNGImpl().randomHexString(REQ_ID_BITS),
                opHash: opHash
            };

            return this.createCommandPromise(cmd);
        } else {
            return Promise.reject('Unexpected error: memory backend proxy is uninitialized (maybe it was closed?)');
        }
    }

    loadOpHeaderByHeaderHash(opHeaderHash: string): Promise<StoredOpHeader | undefined> {
        
        if (this.backend !== undefined) {
            return this.backend.loadOpHeaderByHeaderHash(opHeaderHash);
        } else if (this.commandChannel !== undefined) {
            const cmd: LoadOpHeaderByHeaderHashCmd = {
                type: 'load-op-header-by-header-hash',
                requestId: new RNGImpl().randomHexString(REQ_ID_BITS),
                opHeaderHash: opHeaderHash
            };

            return this.createCommandPromise(cmd);
        } else {
            return Promise.reject('Unexpected error: memory backend proxy is uninitialized (maybe it was closed?)');
        }
    }

    loadTerminalOpsForMutable(hash: string): Promise<{ lastOp: string; terminalOps: string[]; } | undefined> {
        
        if (this.backend !== undefined) {
            return this.backend.loadTerminalOpsForMutable(hash);
        } else if (this.commandChannel !== undefined) {
            const cmd: LoadTerminalOpsForMutableCmd = {
                type: 'load-terminal-ops',
                requestId: new RNGImpl().randomHexString(REQ_ID_BITS),
                mut: hash
            };

            return this.createCommandPromise(cmd);
        } else {
            return Promise.reject('Unexpected error: memory backend proxy is uninitialized (maybe it was closed?)');
        }
    }

    searchByClass(className: string, params?: BackendSearchParams | undefined): Promise<BackendSearchResults> {
        
        if (this.backend !== undefined) {
            return this.backend.searchByClass(className, params);
        } else if (this.commandChannel !== undefined) {
            const cmd: SearchByClassCmd = {
                type: 'search-by-class',
                requestId: new RNGImpl().randomHexString(REQ_ID_BITS),
                className: className,
                params: params
            };

            return this.createCommandPromise(cmd);
        } else {
            return Promise.reject('Unexpected error: memory backend proxy is uninitialized (maybe it was closed?)');
        }
    }

    searchByReference(referringPath: string, referencedHash: string, params?: BackendSearchParams | undefined): Promise<BackendSearchResults> {
        
        if (this.backend !== undefined) {
            return this.backend.searchByReference(referringPath, referencedHash, params);
        } else if (this.commandChannel !== undefined) {
            const cmd: SearchByReferenceCmd = {
                type: 'search-by-reference',
                requestId: new RNGImpl().randomHexString(REQ_ID_BITS),
                referringPath: referringPath,
                 referencedHash: referencedHash,
                 params: params
            };

            return this.createCommandPromise(cmd);
        } else {
            return Promise.reject('Unexpected error: memory backend proxy is uninitialized (maybe it was closed?)');
        }

    }

    searchByReferencingClass(referringClassName: string, referringPath: string, referencedHash: string, params?: BackendSearchParams | undefined): Promise<BackendSearchResults> {
        
        if (this.backend !== undefined) {
            return this.backend.searchByReferencingClass(referringClassName, referringPath, referencedHash, params);
        } else if (this.commandChannel !== undefined) {
            const cmd: SearchByReferencingClassCmd = {
                type: 'search-by-referencing-class',
                requestId: new RNGImpl().randomHexString(REQ_ID_BITS),
                referringClassName: referringClassName,
                referringPath: referringPath,
                referencedHash: referencedHash,
                params: params
            };

            return this.createCommandPromise(cmd);
        } else {
            return Promise.reject('Unexpected error: memory backend proxy is uninitialized (maybe it was closed?)');
        }
    }

    close(): void {
        if (this.backend !== undefined) {
            this.backend.close();
            this.backend = undefined;
        } else if (this.commandChannel !== undefined) {
            this.commandChannel.close();
            this.storedObjectCallbackChannel?.close();

            this.commandChannel = undefined;
            this.storedObjectCallbackChannel = undefined;
        }
    }

    setStoredObjectCallback(objectStoreCallback: (literal: Literal) => Promise<void>): void {
        
        if (this.backend !== undefined) {
            this.backend.setStoredObjectCallback(objectStoreCallback);
        } else {
            this.storedObjectCallback = objectStoreCallback;
        }
    }
}


Store.registerBackend(MemoryBackendProxy.backendName, (url: string) => {

    const parts = url.split('://');

    if (parts[0] !== MemoryBackendProxy.backendName) {
        throw new Error('Trying to open this backend url "' + url + '" using MemoryBackendProxy, but only URLs starting with ' + MemoryBackendProxy.backendName + ':// are supported.');
    }

    const rest = parts.slice(1).join('://');

    const restParts = rest.split('/');

    const enviromentId = restParts[0];
    const dbName = restParts.slice(1).join('/');

    return new MemoryBackendProxy(dbName, enviromentId);
})

export { MemoryBackendProxy };