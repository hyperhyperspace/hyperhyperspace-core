//import { WebRTCConnection } from './sync/transport';


export { Identity, RSAKeyPair, RSAPublicKey } from './data/identity';
export { HashedObject, MutableObject, MutationOp, HashReference, HashedSet, Hashing, Hash, Serialization, Namespace } from './data/model';
export { Store, Backend, IdbBackend } from './data/storage';
export { MutableReference, MutableSet } from './data/containers';

export * from './crypto/ciphers';
export * from './crypto/hashing';
export * from './crypto/random';

//export * from 'rngpoly';
//export * from 'webrtcpoly';
//require('indexeddbpoly');

export * from './net/linkup';
export * from './net/transport';
export * from './mesh/agents/network';
export * from './mesh/agents/peer';
export * from './mesh/agents/state';
export { MeshService, Agent, AgentPod } from './mesh/service';
export { GroupSharedSpace } from './mesh/spaces';

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