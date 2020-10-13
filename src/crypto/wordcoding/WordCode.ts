

class WordCode {

    words: string[];
    wordPositions?: Map<string, number>;
    normalizedWordPositions?: Map<string, number>;

    bitsPerWord: number;
    normalizer?: (word: string) => string;
    

    

    constructor(words: string[], normalizer?: (word: string) => string) {
        this.words = words;
        this.bitsPerWord = Math.log2(this.words.length);
        this.normalizer = normalizer;
    }

    private fillWordPositions(): void {
        if (this.wordPositions === undefined) {
            if (this.normalizer !== undefined) {
                this.normalizedWordPositions = new Map<string, number>();
            }
            this.wordPositions = new Map<string, number>();
            let pos=0;
            for (const word of this.words) {
                this.wordPositions.set(word, pos);
                if (this.normalizer !== undefined) {
                    const norm = this.normalizer(word);
                    if (norm !== word) {
                        this.normalizedWordPositions?.set(norm, pos);
                    }
                }
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

        for (let word of words) {
            
        }

        return '';
    }

    
}