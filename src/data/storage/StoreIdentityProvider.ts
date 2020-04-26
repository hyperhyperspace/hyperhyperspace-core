import { IdentityProvider } from 'data/identity/IdentityProvider';
import { Identity } from 'data/identity/Identity';
import { RSAKeyPair } from 'data/identity/RSAKeyPair';

import { Store } from './Store';
import { Literal, LiteralContext } from 'data/model/HashedObject';



class StoreIdentityProvider implements IdentityProvider {

    store: Store;

    constructor(store: Store) {
        this.store = store;
    }

    async signText(text: string, id: Identity): Promise<string> {
        
        let obj = await this.store.load(id.getKeyPairHash());

        if (obj === undefined) {
            throw new Error('Trying to sign for identity ' + id.hash() + ' but could not find associated key pair in store: ' + id.getKeyPairHash() + '.');
        } else if (obj instanceof RSAKeyPair) {
            const kp = obj as RSAKeyPair;
            return kp.sign(text);
        } else {
            throw new Error('Trying to sign for identity ' + id.hash() + ' but associated key pair ' + id.getKeyPairHash() + ' is not an instance of RSAKeyPair.');
        }

    }

    async signLiteral(literal: Literal): Promise<void> {
        if (literal.author !== undefined && literal.signature === undefined) {
            let obj = this.store.load(literal.author);
            if (obj === undefined) {
                throw new Error('Trying to sign literal for object ' + literal.hash + ' but could not find its author (identity ' + literal.author + ').');
            } else if (obj instanceof Identity) {
                literal.signature = await this.signText(literal.hash, obj as Identity);
            } else {
                throw new Error('Trying to sign literal for object ' + literal.hash + ' but its author ' + literal.author + ' is not an instance of Identity.');
            }
        }
    }

    async signLiteralContext(literalContext: LiteralContext): Promise<void> {
        for (const hash of literalContext.rootHashes) {
            await this.signLiteral(literalContext.literals[hash] as Literal);
        }
    }
}

export { StoreIdentityProvider };