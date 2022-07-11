import { describeProxy } from 'config';
import { MutableSet } from 'data/collections';
import { Identity } from 'data/identity';
import { HashedObject } from 'data/model';
import { LinkupManager } from 'net/linkup';
import { Resources } from 'spaces/Resources';


describeProxy('[SPW] Basic object spawning', () => {
    test('[SPW01]', async (done) => {
        let r1 = await Resources.create();
        let r2 = await Resources.create();

        let example = new MutableSet<string>();

        r1.mesh.addObjectSpawnCallback(
            (object: HashedObject, sender: Identity) => {

                expect(example.equals(object)).toBeTruthy();
                expect(r2.config.id.equals(sender)).toBeTruthy();
            
                done();
            },
            r1.config.id, 
            [LinkupManager.defaultLinkupServer]
        );

        let i=0;
        while (i++<20) {
            await new Promise(r => setTimeout(r, 1000));
            r2.mesh.sendObjectSpawnRequest(example, r2.config.id, r1.config.id, undefined, [LinkupManager.defaultLinkupServer]);
        }
    }, 12000);

});