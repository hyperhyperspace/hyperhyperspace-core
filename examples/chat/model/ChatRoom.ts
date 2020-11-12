import { HashedObject, HashedLiteral } from 'data/model';
import { MutableSet, MutableReference } from 'data/containers';
import { Identity } from 'data/identity';

import { Message } from './Message';

import { SpaceEntryPoint } from 'spaces/SpaceEntryPoint';
import { Mesh } from 'mesh/service';
import { LinkupManager } from 'net/linkup';
import { ObjectDiscoveryPeerSource } from 'mesh/agents/peer';
import { PeerGroupInfo } from 'mesh/service';
import { IdentityPeer } from 'mesh/agents/peer';


class ChatRoom extends HashedObject implements SpaceEntryPoint {

    static className = 'hhs/v0/exampes/ChatRoom';

    topic?: MutableReference<HashedLiteral>
    participants?: MutableSet<Identity>;
    messages?: MutableSet<Message>;

    _mesh?: Mesh;
    _peerGroup?: PeerGroupInfo;

    constructor(topic?: string) {
        super();
        if (topic !== undefined) {
            this.setRandomId();

            this.addDerivedField('topic', new MutableReference());
            this.addDerivedField('participants', new MutableSet());
            this.addDerivedField('messages', new MutableSet());

            this.topic?.setValue(new HashedLiteral(topic));
        }
    }

    init(): void {
        
    }

    validate(_references: Map<string, HashedObject>): boolean {
        return  this.getId() !== undefined &&
                this.checkDerivedField('topic') &&
                this.checkDerivedField('participants') &&
                this.checkDerivedField('messages');
    }

    join(id: Identity) {
        this.participants?.add(id);
        this.getStore().save(this.participants as HashedObject);
        //this.participants?.saveQueuedOps();
    }

    leave(id: Identity) {
        this.participants?.delete(id);
        this.participants?.saveQueuedOps();
    }

    say(author: Identity, text: string) {
        let message = new Message(author, text);
        this.messages?.add(message).then( () => {
            this.getStore().save(this.messages as HashedObject);
        })        
        //this.messages?.saveQueuedOps();
    }

    getParticipants() : MutableSet<Identity> {
        if (this.participants === undefined) {
            throw new Error('The chat room has not been initialized, participants are unavailable.');
        }

        return this.participants;
    }

    getMessages() : MutableSet<Message> {
        if (this.messages === undefined) {
            throw new Error('The chat room has not been initialized, messages are unavailable.');
        }

        return this.messages;
    }

    async startSync(): Promise<void> {

        let resources = this.getResources();

        if (resources === undefined) {
            throw new Error('Cannot start sync: resources not configured.');
        }

        this._mesh = resources.mesh;

        if (this._mesh === undefined) {
            throw new Error('Cannot start sync: mesh is missing from configured resources.');
        }

        let linkupServers = resources.config.linkupServers === undefined?
                            [LinkupManager.defaultLinkupServer] : resources.config.linkupServer as string[];



        const localIdentity = resources.config.id as Identity;
        const localPeer     = await new IdentityPeer(linkupServers[0] as string, localIdentity.hash(), localIdentity).asPeer();

        this._mesh.startObjectBroadcast(this, linkupServers, [localPeer.endpoint]);

        let peerSource = new ObjectDiscoveryPeerSource(this._mesh, this, linkupServers, localPeer.endpoint, IdentityPeer.getEndpointParser(resources.store));

        this._peerGroup = {
            id: 'sync-for-' + this.hash(),
            localPeer: localPeer,
            peerSource: peerSource
        }

        this._mesh.joinPeerGroup(this._peerGroup);
        this._mesh.syncObjectWithPeerGroup(this._peerGroup.id, this);

        this.participants?.loadAndWatchForChanges();
        this.messages?.loadAndWatchForChanges();
    }
    
    async stopSync(): Promise<void> {

        const peerGroupId = this._peerGroup?.id as string;
        
        this._mesh?.stopSyncObjectWithPeerGroup(peerGroupId, this.hash());
        this._mesh?.stopObjectBroadcast(this.hash());
        this._mesh?.leavePeerGroup(peerGroupId);

        this._mesh = undefined;
        this._peerGroup = undefined;
    }

    getClassName(): string {
        return ChatRoom.className;
    }

}

HashedObject.registerClass(ChatRoom.className, ChatRoom);

export { ChatRoom };