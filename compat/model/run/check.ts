import { Context, HashedObject } from 'data/model';
import hashingChecks from '../hashing';

import * as fs from 'fs';


async function loadFromFile(filename: string, validate=true): Promise<Context> {

    let ctx = new Context();

    let contents = fs.readFileSync(filename, {encoding: 'utf-8'});

    ctx.fromLiteralContext(JSON.parse(contents));
    
    for (const hash of ctx.rootHashes) {
        const obj = await (validate?
                                HashedObject.fromContextWithValidation(ctx, hash)
                                    :
                                HashedObject.fromContext(ctx, hash));
        ctx.objects.set(hash, obj);
    }

    return ctx;
}

const src = './compat/model/data';

async function run() {

    for (const t of hashingChecks) {

        console.log(t.slug + ': ' + t.desc);
    
        const ctx = await loadFromFile(src + '/' + t.slug + '.ctx');

        if (t.check(ctx)) {
            console.log('pass');
        } else {
            console.log('fail');
        }
    }

}

run();