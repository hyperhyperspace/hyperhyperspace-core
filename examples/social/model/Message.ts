import { HashedObject } from 'data/model';
import { Identity } from 'data/identity';

class Message extends HashedObject {

    static className = 'hhs/v0/examples/Message';

    constructor(author?: Identity, text?: string) {
        super();
    
        if (author !== undefined) {
            this.setAuthor(author);
            this.text = text;
        }
    }

    text?: string;

    getClassName(): string {
        return Message.className;
    }

    init(): void {
        
    }

    validate(_references: Map<string, HashedObject>): boolean {
        return this.text !== undefined && this.getAuthor() !== undefined;
    }

}

HashedObject.registerClass(Message.className, Message);

export { Message }