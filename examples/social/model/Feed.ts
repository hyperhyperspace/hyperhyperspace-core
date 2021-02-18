import { HashedObject, HashedLiteral } from 'data/model';
import { MutableSet, MutableReference } from 'data/containers';
import { Identity } from 'data/identity';

import { Message } from './Message';

import { SpaceEntryPoint } from 'spaces/SpaceEntryPoint';
import { PeerNode } from 'mesh/service';


class Feed extends HashedObject implements SpaceEntryPoint {

    static className = 'hhs/v0/examples/Feed';

    bio?: MutableReference<HashedLiteral>
    posts?: MutableSet<Message>;

    _node?: PeerNode;

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

        if (resources.config?.id === undefined) {
            throw new Error('Cannot start sync: local identity has not been defined.');
        }

        if (resources.store === undefined) {
            throw new Error('Cannot start sync: a local store has not been configured.')
        }

        this._node = new PeerNode(resources);
        
        this._node.broadcast(this);
        this._node.sync(this);




        this.posts?.loadAndWatchForChanges();
    }
    
    async stopSync(): Promise<void> {

        this._node?.stopBroadcast(this);
        this._node?.stopSync(this);
    }

    getClassName(): string {
        return Feed.className;
    }

}

HashedObject.registerClass(Feed.className, Feed);

export { Feed };