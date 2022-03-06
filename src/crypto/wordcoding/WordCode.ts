import { dictName as englishDictName,
         words as englishWords } from './dicts/english';
import { dictName as spanishDictName, 
         normalizer as spanishNormalizer, 
         words as spanishWords } from './dicts/spanish';



class WordCode {

    static english = new WordCode(englishDictName, englishWords);
    static spanish = new WordCode(spanishDictName, spanishWords, spanishNormalizer);

    static lang = new Map<String, WordCode>([['es', WordCode.spanish], ['en', WordCode.english]]);
    
    static all  = [WordCode.english, WordCode.spanish];

    dictName : string;
    words    : string[];

    wordPositions?: Map<string, number>;

    bitsPerWord: number;
    normalizer: (word: string) => string;

    constructor(dictName: string, words: string[], normalizer?: (word: string) => string) {
        this.dictName = dictName;
        this.words    = words;
        this.bitsPerWord = Math.log2(this.words.length);
        this.normalizer = normalizer === undefined? (x: string) => x.toLowerCase() : normalizer;
    }

    private fillWordPositions(): void {
        if (this.wordPositions === undefined) {

            this.wordPositions = new Map<string, number>();
            let pos=0;
            for (const word of this.words) {
                this.wordPositions.set(this.normalizer(word), pos);
                pos = pos + 1;
            }
        }
    } 

    // encode: get a hex string (containing a multiple of bitsPerWord bits), 
    // and get a sequence of words encoding it
    encode(hex: string): string[] {

        const nibblesPerWord = this.bitsPerWord / 4;

        let wordNibbles = '';
        let words: string[] = [];

        for (let i=0 ; i<hex.length; i++) {
            wordNibbles = wordNibbles + hex[i];
            if (wordNibbles.length === nibblesPerWord) {
                words.push(this.encodeWord(wordNibbles));
                wordNibbles='';
            }
        }

        if (wordNibbles.length !== 0) {
            throw new Error('Trying to word-encode a hex string whose lenght does not correspond to a multiple of the bits-per-word constant.');
        }

        return words;
    }

    private encodeWord(hex: string): string {

        const pos = Number.parseInt(hex, 16);

        if (pos >= this.words.length) {
            throw new Error('Number is too large to encode as a single word');
        }

        return this.words[pos];
    }

    // decode: get a sequence of words, return the hex value they encode.
    decode(words: string[]): string {
        this.fillWordPositions();

        let result = '';

        const nibblesPerWord = this.bitsPerWord / 4;

        for (let word of words) {
            let position = this.wordPositions?.get(this.normalizer(word));

            if (position === undefined) {
                throw new Error('Trying to decode wordcoded number but received a word that is not in the dictionary "' + this.dictName + '":' + word);
            }

            result = result + position.toString(16).padStart(nibblesPerWord, '0');
        }

        return result.toUpperCase();
    }
    
    check(word: string) {
        this.fillWordPositions();

        return this.wordPositions?.get(this.normalizer(word)) !== undefined;
    }
}

export { WordCode };