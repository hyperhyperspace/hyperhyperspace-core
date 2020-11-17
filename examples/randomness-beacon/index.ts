import { Beacon } from './model/Beacon';
import { RNGImpl } from 'crypto/random';

const STEPS = 66;

async function main() {

    console.log('creating random beacon...');

    let beacon = new Beacon(new RNGImpl().randomHexString(128), STEPS);

    //let res = await Beacon.computeVdfAsync(STEPS, new RNGImpl().randomHexString(128));

    beacon.startCompute();

}

main();