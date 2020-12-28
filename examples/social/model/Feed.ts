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


class Feed extends HashedObject implements SpaceEntryPoint {

    static className = 'hhs/v0/examples/Feed';

    bio?: MutableReference<HashedLiteral>
    posts?: MutableSet<Message>;

    _mesh?: Mesh;
    _peerGroup?: PeerGroupInfo;

    constructor(author?: Identity) {
        super();
        if (author !== undefined) {
            this.setId('-feed-'+author.hash());

            this.addDerivedField('bio', new MutableReference());
            
            this.addDerivedField('posts', new MutableSet());
            this.posts?.setAuthor(author);

            this.setAuthor(author);
        }
    }

    init(): void {
        
    }

    validate(_references: Map<string, HashedObject>): boolean {
        let author = this.getAuthor();
        return  this.getId() !== undefined &&
                author !== undefined &&
                this.getId() === '-feed-'+this.getAuthor()?.hash() &&
                this.checkDerivedField('bio') &&
                author.equals(this.bio?.getAuthor()) &&
                this.checkDerivedField('posts') &&
                author.equals(this.posts?.getAuthor());
    }

    setBio(bio: string) {
        this.bio?.setValue(new HashedLiteral(bio));
        this.getStore().save(this.bio as HashedObject);
    }

    publish(author: Identity, text: string) {
        let message = new Message(author, text);
        this.posts?.add(message).then( () => {
            this.getStore().save(this.posts as HashedObject);
        })        
        //this.messages?.saveQueuedOps();
    }

    getPosts() : MutableSet<Message> {
        if (this.posts === undefined) {
            throw new Error('The chat room has not been initialized, messages are unavailable.');
        }

        return this.posts;
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

        this.posts?.loadAndWatchForChanges();
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
        return Feed.className;
    }

}

HashedObject.registerClass(Feed.className, Feed);

export { Feed };