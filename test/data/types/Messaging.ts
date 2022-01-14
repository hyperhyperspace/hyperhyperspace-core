import { CausalSet, SingleAuthorCausalSet } from 'data/containers';
import { Identity } from 'data/identity';
import { Authorization, Hash, HashedObject } from 'data/model';
import { FeatureSet } from './FeatureSet';

enum Features {
    OpenPost = 'open-post',
    AnonRead = 'anon-read'
}

// a small moderated message set to test invalidation & cascaded undos / redos

class Message extends HashedObject {
    static className = 'hhs-test/Message';

    text?: string;
    timestamp?: number;

    consructor(text?: string, author?: Identity) {

        if (text !== undefined) {
            this.setRandomId();
            
            this.text = text;

            if (author === undefined) {
                throw new Error('A Message must have an author.');
            }

            this.setAuthor(author);
            this.timestamp = Date.now();
        }
    }

    getClassName(): string {
        return Message.className;
    }

    init(): void {
        
    }

    async validate(references: Map<string, HashedObject>): Promise<boolean> {
        references;

        return this.getAuthor() !== undefined && this.text !== undefined && this.timestamp !== undefined;
    }
}

class MessageSet extends CausalSet<Message> {

    static className = 'hss-test/MessageSet';

    static features = [Features.OpenPost, Features.AnonRead];

    config?: FeatureSet;

    constructor(owner?: Identity) {
        super();

        if (owner !== undefined) {

            const authorized = new SingleAuthorCausalSet<Identity>(owner);
            authorized.setAuthor(owner);

            this.config = new FeatureSet(authorized, MessageSet.features);
        }
    }

    async post(msg: Message): Promise<boolean> {

        const author = msg.getAuthor();

        if (author === undefined) {
            throw new Error('Messages cannot be posted if they do not have an author.');
        }

        const auth = this.createAuthorizerFor(author);
        
        return this.add(msg, author, auth);
    }

    getConfig() {
        return this.config as FeatureSet;
    }

    async validate(references: Map<Hash, HashedObject>) {
        references;

        return true;
    }

    getClassName() {
        return MessageSet.className;
    }

    private createAuthorizerFor(author: Identity) {

        return Authorization.oneOf(
                    [this.getConfig().createMembershipAuthorizer(Features.OpenPost),
                    this.getConfig().getAuthorizedIdentitiesSet().createMembershipAuthorizer(author)]);
    }

}

HashedObject.registerClass(MessageSet.className, MessageSet);

export { Features, Message, MessageSet }