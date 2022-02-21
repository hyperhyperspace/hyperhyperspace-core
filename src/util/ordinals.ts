
type Ordinal = string;

// Ordinals are strings in the a-z alphabet that do not end with an 'a'.

class Ordinals {
    static isOrdinal(o: Ordinal): boolean {
        return o.length > 0 && (typeof o) === 'string' && 
               /^[a-z]*[b-z]$/g.test(o);
    }
}

const first    = 'a';
const last     = 'z';
const midpoint = 'm';
const minCharCode = first.charCodeAt(0);
const maxCharCode = last.charCodeAt(0);

class DenseOrder {

    static between(after?: Ordinal, before?: Ordinal): Ordinal {

        const afterLen  = after === undefined? 0 : after.length;
        const beforeLen = before === undefined? 0 : before.length; 

        let done = false;

        let smallerPrefix = false;
        let i=0;
        let o = '';

        // invariants: either after < o < before, or 1. && 2. hold
        //
        //
        //             1. either after[:i] === before[:i] && !smallerPrefix
        //                    or after[:i]  <  before[:i] && smallerPrefix
        //
        //             2. o.length === i && o[:i] === (after + ['z'|'a'...])[:i]
        //
        //                ('o' contains a copy of 'after' up to i,
        //                 padded with 'a's if 'after' is too short and 'z's if 'before' is)

        while (!done) {
            const afterCharCode  = i < afterLen? after?.charCodeAt(i) : undefined;
            const beforeCharCode = i < beforeLen? before?.charCodeAt(i) : undefined;

            if (afterCharCode !== undefined && beforeCharCode !== undefined) {

                if (!smallerPrefix && afterCharCode > beforeCharCode) {
                    throw new Error('Asked for ordinal between ' + after + ' and ' + before + ', but the latter is larger than the former (larger first char)')
                }
                
                if ((smallerPrefix && afterCharCode < maxCharCode) || afterCharCode + 1 < beforeCharCode) {
                    o = o + String.fromCharCode(afterCharCode + 1);
                    done = true;    
                } else {
                    if (afterCharCode < beforeCharCode) {
                        smallerPrefix = true;
                    }
                    o = o + (after as string)[i];
                    i = i + 1;
                }
            } else if (afterCharCode !== undefined) {

                if (before !== undefined && !smallerPrefix) {
                    throw new Error('Asked for ordinal between ' + after + ' and ' + before + ', but the latter is larger than the former (prefix)');
                }

                if (afterCharCode < maxCharCode) {
                    o = o + String.fromCharCode(afterCharCode + 1);
                    done = true;
                } else {
                    o = o + (after as string)[i]; // + 'z'
                    i = i + 1;
                }
            } else if (beforeCharCode !== undefined) {

                if (smallerPrefix) {
                    o = o + midpoint;
                    done = true;
                } else {
                    if (beforeCharCode > minCharCode) {
                        o = o + String.fromCharCode(beforeCharCode - 1);
                        if (beforeCharCode - 1 > minCharCode) {
                            done = true;
                        } else {
                            smallerPrefix = true;
                        }
                        
                    } else {
                        o = o + (before as string)[i]; // + 'a'
                        i = i + 1;
                    }
                }
            } else {
                o = o + midpoint;
                done = true;
            }

        }

        return o;
    }

}

export { Ordinal, Ordinals, DenseOrder };