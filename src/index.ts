import { Swarm } from './sync/swarm';
//import { WebRTCConnection } from './sync/transport';


export * from 'data/identity';
export * from 'data/model';
export * from 'data/storage';

export * from 'crypto/ciphers';
export * from 'crypto/hashing';
export * from 'crypto/random';

export * from 'rngpoly';
export * from 'webrtcpoly';
require('indexeddbpoly');

export * from 'sync/linkup';
export * from 'sync/swarm';
export * from 'sync/transport';

console.log(' it runs ');

//new Swarm('topic');

Swarm;
//WebRTCConnection;