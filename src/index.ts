//import { WebRTCConnection } from './sync/transport';


export * from 'data/identity';
export * from 'data/model';
export * from 'data/storage';

export * from 'crypto/ciphers';
export * from 'crypto/hashing';
export * from 'crypto/random';

//export * from 'rngpoly';
//export * from 'webrtcpoly';
require('indexeddbpoly');

export * from 'net/linkup';
export * from 'net/transport';
export * from 'mesh/agents/network';
export * from 'mesh/agents/peer';
export * from 'mesh/agents/state';
export * from 'mesh/spaces';

/*
console.log(' it runs ');

let b = new IdbBackend('test');
let s = new Store(b);

let kp = RSAKeyPair.generate(512);
let id = Identity.fromKeyPair({'name': 'test'}, kp);

s.save(kp).then(() => { s.save(id) });

console.log(id.hash());
*/
//new Swarm('topic');
//WebRTCConnection;