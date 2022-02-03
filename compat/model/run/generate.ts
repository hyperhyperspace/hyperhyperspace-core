import { Context } from 'data/model';
import hashingChecks from '../hashing';

import * as fs from 'fs';

function saveToFile(ctx: Context, filename: string) {
    const contents = JSON.stringify(ctx.toLiteralContext());

    fs.writeFileSync(filename, contents, {encoding: 'utf-8'});
}

const dest = './compat/model/data-ts';

if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest);
}

for (const t of hashingChecks) {
    
    let ctx = new Context();
    for (const obj of t.gen()) {
        obj.toContext(ctx);
    }

    saveToFile(ctx, dest + '/' + t.slug + '.ctx');
    console.log('generated ' + t.slug + '.ctx');
}