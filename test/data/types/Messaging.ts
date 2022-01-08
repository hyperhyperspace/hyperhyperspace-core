import { CausalSet } from 'data/containers';
import { Identity } from 'data/identity';
import { Authorizer, HashedObject, MutationOp } from 'data/model';
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

    static features = [Features.OpenPost, Features.AnonRead];

    config?: FeatureSet;

    constructor(owner?: Identity) {
        super();

        if (owner !== undefined) {

            const authorized = new CausalSet<Identity>();
            authorized.setAuthor(owner);

            this.config = new FeatureSet(authorized, MessageSet.features);
        }
    }

    async post(msg: Message): Promise<boolean> {

        let authorizer: Authorizer | undefined;

        const author = msg.getAuthor();

        if (author === undefined) {
            throw new Error('Messages cannot be posted if they do not have an author.');
        }

        if (this.config?.has(Features.OpenPost)) {
            authorizer = async (op: MutationOp) => await this.getConfig().attestMembershipForOp(Features.OpenPost, op);
        } else if (this.config?.authorized?.has(author)) {
            authorizer = async (op: MutationOp) => await this.getConfig().getAuthorizedIdentitiesSet().attestMembershipForOp(author, op);
        } else {
            return false;
        }

        return this.add(msg, author, authorizer);
    }

    getConfig() {
        return this.config as FeatureSet;
    }


}

export { Features, Message, MessageSet }