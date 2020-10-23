import { RNGImpl } from 'crypto/random';
import { WordCode } from 'crypto/wordcoding';
import { describeProxy } from 'config';

describeProxy('[WCO] Word-coding', () => {
    test('[WCO01] Encode-deocde test: English', () => {
        testWordCode(WordCode.english);
    });
    test('[WCO02] Encode-decode test: Spanish', () => {
        testWordCode(WordCode.spanish);
    })
});

const testWordCode = (wc: WordCode) => {
    for (let i=1; i<7; i++) {
        let hex = new RNGImpl().randomHexString(wc.bitsPerWord * i)
        let words = wc.encode(hex);
        expect(words.length).toEqual(i);
        let dec = wc.decode(words);
        expect(dec).toEqual(hex);
    }
};