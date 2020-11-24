

import { Identity } from 'data/identity';
import { RSAKeyPair } from 'data/identity';

import { RNGImpl } from 'crypto/random';



import { Space } from 'spaces/Space';
import { Resources } from 'data/model';

import { Store } from 'storage/store';
import { MemoryBackend } from 'storage/backends';

import { Mesh } from 'mesh/service';
import { IdentityPeer } from 'mesh/agents/peer';

import { Beacon } from './model/Beacon';
import { BeaconValueOp } from './model/BeaconValueOp';

import * as readline from 'readline';
import { VDF } from './model/VDF';


const STEPS = 10000;

function initResources(): Resources {
    return { store: new Store(new MemoryBackend(new RNGImpl().randomHexString(128))), mesh: new Mesh(), config: {}, aliasing: new Map()};
}

async function createBeaconSpace(resources: Resources, steps=STEPS): Promise<Space> {
    console.log();
    console.log('Generating new randomness beacon...');
    let beacon = new Beacon(new RNGImpl().randomHexString(160), steps);
    
    const keyPair = RSAKeyPair.generate(1024);
    const localIdentity = Identity.fromKeyPair({}, keyPair);
    console.log('Generated keys.')

    resources.config.id = localIdentity;

    let endpoint = (await IdentityPeer.fromIdentity(localIdentity).asPeer()).endpoint;

    let space = Space.fromEntryPoint(beacon, resources, endpoint);
    space.startBroadcast();

    await resources.store.save(beacon);

    beacon.setResources(resources);
    beacon.startSync();

    console.log();
    console.log('Beacon is ready, wordcode is:');
    console.log();
    console.log((await space.getWordCoding()).join(' '));
    console.log();

    return space;
}

async function joinBeaconSpace(resources: Resources, wordcode: string[]): Promise<Space> {
    const keyPair = RSAKeyPair.generate(1024);
    const localIdentity = Identity.fromKeyPair({}, keyPair);
    resources.config.id = localIdentity;
    console.log();
    console.log('Generated keys.')

    
    let endpoint = (await IdentityPeer.fromIdentity(localIdentity).asPeer()).endpoint;
    let space = Space.fromWordCode(wordcode, resources, endpoint);

    console.log();
    console.log('Trying to join randomness beacon with word code "' + wordcode.join(' ') + '"...');
    await space.entryPoint;
    console.log('Done.');
    console.log();

    space.startBroadcast();
    let beacon = await space.getEntryPoint();

    await resources.store.save(beacon);

    beacon.setResources(resources);
    beacon.startSync();

    return space;
}

async function main() {

    await BeaconValueOp.vdfInit();

    let resources = initResources();

    let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log();
    console.log('Press enter to create a new beacon, or input the 3 code words to join computing an existing one.');
    console.log();

    let command = await new Promise((resolve: (text: string) => void/*, reject: (reason: any) => void*/) => {
        rl.question('>', (command: string) => {
            resolve(command);
        });
    });

    let space: Space;
    if (command.trim() === 'selftest') { 

        console.log('starting self test...');
        console.log();
        await VDF.compute(new RNGImpl().randomHexString(160), 10000);
        console.log();
        console.log('self test done');

        return;

    } else if (command.trim() === '') {

        space = await createBeaconSpace(resources);

    } else {

        let wordcode: string[] = command.split(' ');

        if (wordcode.length !== 3) {
            console.log('expected 3 words, like: pineapple greatness flurry');
            console.log('cannot join beacon, exiting.');
            process.exit();
        }

        space = await joinBeaconSpace(resources, wordcode);
    }

    let beacon = await space.getEntryPoint() as Beacon;

    console.log('Starting VDF computation...');
    console.log();

    beacon.startCompute();

}

main();