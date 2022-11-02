import { Identity } from 'data/identity';
import { Hash, HashedObject, MutableObject } from 'data/model';
import { LinkupAddress } from 'net/linkup';
import { ObjectDiscoveryReply } from '../../agents/discovery';
import { SpawnCallback } from '../../agents/spawn';

import { AsyncStream } from 'util/streams';
import { Endpoint } from '../../agents/network';
import { PeerGroupAgentConfig, PeerGroupState } from '../../agents/peer';
import { SyncObserver, SyncState } from '../../agents/state';
import { PeerGroupInfo, SyncMode, UsageToken } from '../Mesh';

type PeerGroupId = string;

interface MeshInterface {
    
    joinPeerGroup(pg: PeerGroupInfo, config?: PeerGroupAgentConfig, usageToken?: UsageToken): UsageToken;
    leavePeerGroup(token: UsageToken): void;
    
    getPeerGroupState(peerGroupId: PeerGroupId): Promise<PeerGroupState|undefined>;

    syncObjectWithPeerGroup(peerGroupId: PeerGroupId, obj: HashedObject, mode?:SyncMode, usageToken?: UsageToken): UsageToken;
    syncManyObjectsWithPeerGroup(peerGroupId: PeerGroupId, objs: IterableIterator<HashedObject>, mode?:SyncMode, usageTokens?: Map<Hash, UsageToken>): Map<Hash, UsageToken>;
    stopSyncObjectWithPeerGroup(usageToken: UsageToken): void;
    stopSyncManyObjectsWithPeerGroup(tokens: IterableIterator<UsageToken>): void;

    getSyncState(mut: MutableObject, peerGroupId?: string): Promise<SyncState|undefined>;
    addSyncObserver(obs: SyncObserver, mut: MutableObject, peerGroupId?: PeerGroupId): void;
    removeSyncObserver(obs: SyncObserver, mut: MutableObject, peerGroupId?: PeerGroupId): void;

    startObjectBroadcast(object: HashedObject, linkupServers: string[], replyEndpoints: Endpoint[], broadcastedSuffixBits?: number, usageToken?: UsageToken): UsageToken;
    stopObjectBroadcast(token: UsageToken): void;

    findObjectByHash(hash: Hash, linkupServers: string[], replyAddress: LinkupAddress, count?: number, maxAge?: number, strictEndpoints?: boolean, includeErrors?: boolean) : AsyncStream<ObjectDiscoveryReply>;
    findObjectByHashSuffix(hashSuffix: string, linkupServers: string[], replyAddress: LinkupAddress, count?: number, maxAge?: number, strictEndpoints?: boolean, includeErrors?: boolean) : AsyncStream<ObjectDiscoveryReply>;
    findObjectByHashRetry(hash: Hash, linkupServers: string[], replyAddress: LinkupAddress, count?: number): void;
    findObjectByHashSuffixRetry(hashSuffix: string, linkupServers: string[], replyAddress: LinkupAddress, count?: number): void;

    addObjectSpawnCallback(callback: SpawnCallback, receiver: Identity, linkupServers: Array<string>, spawnId?: string): void;
    sendObjectSpawnRequest(object: HashedObject, sender: Identity, receiver: Identity, senderEndpoint: Endpoint, receiverLinkupServers: Array<string>, spawnId?: string): void;

    shutdown(): void;

}

export { MeshInterface }