import { RSAPublicKey as _PK } from 'data/identity';
import { HashedObject } from 'data/model';
import { TestIdentity } from './types/TestIdentity';
import { describeProxy } from '../config';

describeProxy('Identity', () => {
    test( 'Basic identity', () => {

        let keyPair = TestIdentity.getFistTestKeyPair();

        let id = TestIdentity.getFirstTestIdentity();

        let literal1 = id.toLiteralContext();

        let id2 = HashedObject.fromLiteralContext(literal1);

        expect(id.equals(id2)).toBeTruthy();

        let text = 'a short string';

        let signature = keyPair.sign(text);

        expect(id.verify(text, signature)).toBeTruthy();

    });

    test( 'Identity keypair hash generation', () => {
        let keyPair = TestIdentity.getFistTestKeyPair();

        let id = TestIdentity.getFirstTestIdentity();
        
        expect(id.getKeyPairHash()).toEqual(keyPair.hash());
    });
});