import { RSAPublicKey as _PK } from 'data/identity';
import { HashedObject } from 'data/model';
import { TestIdentity } from './types/TestIdentity';
import { describeProxy } from '../config';

describeProxy('[IDN] Identity', () => {
    test( '[IDN01] Basic identity', async () => {

        let keyPair = await TestIdentity.getFistTestKeyPair();

        let id = await TestIdentity.getFirstTestIdentity();

        let literal1 = id.toLiteralContext();

        let id2 = HashedObject.fromLiteralContext(literal1);

        expect(id.equals(id2)).toBeTruthy();

        let text = 'a short string';

        let signature = await keyPair.sign(text);

        expect(id.verifySignature(text, signature)).toBeTruthy();

    });

    test( '[IDN02] Identity keypair hash generation', async () => {
        let keyPair = await TestIdentity.getFistTestKeyPair();

        let id = await TestIdentity.getFirstTestIdentity();
        
        expect(id.getKeyPairHash()).toEqual(keyPair.hash());
    });
});