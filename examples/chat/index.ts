


//$Env:NODE_PATH="dist-chat/src;dist-chat/examples/chat"


import '@hyper-hyper-space/node-env';
import { Identity } from 'data/identity';
import { RSAKeyPair } from 'data/identity';

import { Space } from 'spaces/Space';
import { Resources } from 'data/model';
import { Store } from 'storage/store';
//import { IdbBackend } from 'storage/backends';
import { RNGImpl } from 'crypto/random';

import { MemoryBackend } from 'storage/backends';
import { Mesh } from 'mesh/service';
import { IdentityPeer } from 'mesh/agents/peer';

import { ChatRoom } from './model/ChatRoom';
import { Message } from './model/Message';

import * as readline from 'readline';

function initResources(): Resources {
    return { store: new Store(new MemoryBackend(new RNGImpl().randomHexString(128))), mesh: new Mesh(), config: {}, aliasing: new Map()};
}

async function createIdentity(resources: Resources, name: string): Promise<Identity> {
    console.log('Generating RSA key for ' + name + '...');
    let key = RSAKeyPair.generate(1024);
    console.log('Done.');
    let id = Identity.fromKeyPair({name: name}, key);

    
    await resources.store.save(key);
    await resources.store.save(id);

    resources.config.id = id;

    return id;
}

async function createChatRoomSpace(resources: Resources, id: Identity, topic?: string): Promise<Space> {

    let chatRoom = new ChatRoom(topic);
    let endpoint = (await IdentityPeer.fromIdentity(id).asPeer()).endpoint;

    let space = Space.fromEntryPoint(chatRoom, resources, endpoint);

    space.startBroadcast();
    let room = await space.getEntryPoint();

    await resources.store.save(room);

    room.setResources(resources);
    room.startSync();

    console.log('Created chat room, wordcode is "' + (await space.getWordCoding()).join(' ') + '".');

    return space;
}

async function joinChatRoomSpace(resources: Resources, id: Identity, wordcode: string[]): Promise<Space> {
    
    let endpoint = (await IdentityPeer.fromIdentity(id).asPeer()).endpoint;
    let space = Space.fromWordCode(wordcode, resources, endpoint);

    console.log('Trying to join chat with word code "' + wordcode.join(' ') + '"...');
    await space.entryPoint;
    console.log('Done.');

    space.startBroadcast();
    let room = await space.getEntryPoint();

    await resources.store.save(room);

    room.setResources(resources);
    room.startSync();

    return space;
}


async function main() {

    let resources = initResources();

    let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    let name = await new Promise((resolve: (name: string) => void/*, reject: (reason: any) => void*/) => {
        rl.question('Enter your name to start chat: ', (name: string) => {
            resolve(name);
        });
    });

    let id = await createIdentity(resources, name);


    let command = process.argv[2];

    let space: Space;
    if (command === '--create') {

        let topic:string|undefined = undefined;

        if (process.argv.length>3) {
            topic = process.argv[3];
        }

        space = await createChatRoomSpace(resources, id, topic);

    } else if (command === '--join') {

        let wordcode: string[] = [];

        for(let i=0; i<3; i++) {
            wordcode.push(process.argv[3+i]);
        }

        space = await joinChatRoomSpace(resources, id, wordcode);
    } else {
        throw new Error('Unknown command: ' + command + '.');
    }

    let room = await space.getEntryPoint() as ChatRoom;

    room.messages?.onAddition((m: Message) => {
        console.log(m.getAuthor()?.info?.name + ': ' + m.text);
    });

    console.log('Type and press return to send a message!')

    while (true) {
        let text = await new Promise((resolve: (text: string) => void/*, reject: (reason: any) => void*/) => {
            rl.question('', (name: string) => {
                resolve(name);
            });
        });
    
        room.say(id, text);
    }

    
}

main();