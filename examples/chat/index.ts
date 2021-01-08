


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

import { ChatRoom } from './model/ChatRoom';
import { Message } from './model/Message';

import * as readline from 'readline';

function initResources(): Resources {
    return { store: new Store(new MemoryBackend(new RNGImpl().randomHexString(128))), mesh: new Mesh(), config: {}, aliasing: new Map()};
}

async function createIdentity(resources: Resources, name: string): Promise<Identity> {
    console.log();
    console.log('Generating RSA key for ' + name + '...');
    let key = RSAKeyPair.generate(1024);
    console.log('Done.');
    let id = Identity.fromKeyPair({name: name}, key);

    
    await resources.store.save(key);
    await resources.store.save(id);

    resources.config.id = id;

    return id;
}

async function createChatRoomSpace(resources: Resources, topic?: string): Promise<Space> {

    let chatRoom = new ChatRoom(topic);

    let space = Space.fromEntryPoint(chatRoom, resources);

    space.startBroadcast();
    let room = await space.getEntryPoint();

    await resources.store.save(room);

    room.setResources(resources);
    room.startSync();

    console.log();
    console.log('Created chat room, wordcode is:');
    console.log();
    console.log((await space.getWordCoding()).join(' '));
    console.log();

    return space;
}

async function joinChatRoomSpace(resources: Resources, wordcode: string[]): Promise<Space> {
    
    let space = Space.fromWordCode(wordcode, resources);

    console.log();
    console.log('Trying to join chat with word code "' + wordcode.join(' ') + '"...');
    await space.entryPoint;
    console.log('Done.');
    console.log();

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

    console.log();
    let name = await new Promise((resolve: (name: string) => void/*, reject: (reason: any) => void*/) => {
        rl.question('Enter your name: ', (name: string) => {
            resolve(name);
        });
    });

    let id = await createIdentity(resources, name);

    console.log();
    console.log('Press enter to create a chat room, or input the 3 code words to join an existing one.');
    console.log();

    let command = await new Promise((resolve: (text: string) => void/*, reject: (reason: any) => void*/) => {
        rl.question('>', (command: string) => {
            resolve(command);
        });
    });

    let space: Space;
    if (command.trim() === '') {

        space = await createChatRoomSpace(resources, '');

    } else {

        let wordcode: string[] = command.split(' ');

        if (wordcode.length !== 3) {
            console.log('expected 3 words, like: pineapple greatness flurry');
            console.log('cannot join chat, exiting.');
            process.exit();
        }

        space = await joinChatRoomSpace(resources, wordcode);
    }

    let room = await space.getEntryPoint() as ChatRoom;

    room.messages?.onAddition((m: Message) => {
        console.log(m.getAuthor()?.info?.name + ': ' + m.text);
    });

    console.log('Type and press return to send a message!')
    console.log();

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