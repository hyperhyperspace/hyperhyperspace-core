import { SHA, SHAImpl } from 'crypto/hashing';
import { RMD, RMDImpl } from 'crypto/hashing';
import { describeProxy } from 'config';

describeProxy('[HSH] Hashing', () => {
    test('[HSH01] SHA256 test', () => {
        let sha = new SHAImpl() as SHA;
        let message = 'say hi to the sha';
        let hash    = sha.sha256hex(message);
        let correctHash = 'cc2a21bc5a8456cca36023a867bec833dc9a4cae7186ec03fabc0655da8c9787';
        expect(hash).toEqual(correctHash);
    });

    test('[HSH02] RMD160 test', () => {
        let rmd = new RMDImpl() as RMD;
        let message = 'say hi to the sha';
        let hash    = rmd.rmd160hex(message);
        let correctHash = 'ec483cf2d838bb73dfd999975b5a2110083d64ed';
        expect(hash).toEqual(correctHash);
    });
});