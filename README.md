# The Hyper Hyper Space core library

> An offline-first shared data library for creating p2p apps in the browser.

## Intro

In the same way in which the Internet bridges networks together, the HHS attempts to decouple data from the apps used to manage it, thus enabling individuals to have better ownership and control over their information.

Apps that use the HHS model store infromation locally (the current implementation works in a modern web browser, effectively turning it into an autonomus node in a p2p network).

Apps will most of the time work on the local store as if it were universal (i.e. a magic database that contains all the needed information from everybody). The HHS library contains networking primitives that allow apps to from ad-hoc groups of peers that make the necessary information flow from one local store to another. Usually each app module can be split in two, cleanly separating all the information handling from the synchronization logic.

**This project is experimental. All APIs may change, bugs exist and the crypto has not been audited.**


## Objectives

Enable the creation of p2p apps that work in-browser, without requiring _any_ infrastructure, and that are as practical and functional as centralized apps. Find abstractions and algorithms that make creating and reasoning about this apps intuitive and predictable. Explore new models for online collaboration platforms that follow the p2p model while are frictionless to use for the general public, and are

- respectful of everyone's privacy and data ownership rights
- transparent in their handling of information

by default.

## Data model

To enable the eventual sharing and synchronizing of local data, the HHS store follows the following considerations:

 - **The store saves only typed objects.** This allows performing basic semantic validation when new information is received from untrusted sources.
 - **Objects are retrieved using content-based addressing.** HHS provides a standard way to hash objects, and this hashes are the only way to refer to them. The store works as a key-value store, with hashes as keys, and objects are thus immutable.
 - **Objects can reference each other explicitly using their hashes.** Objects and their references thus form an immutable append-only DAG.
 - **Mutability is modelled through operational [CRDT](https://crdt.tech/)s.** Mutation ops are also represented as objects in the store. The type of the object determines how the operations will be interpeted, and how to derive state from them. 
 - **Identities are cryptographic.** HHS identities combine a public key with optional infornation about its holder. They are represented as an object in the store, and are referenced by their hash.
 - **Data validation / authentication is cryptographic.** Object authorship within the store is implemented using hashing and signatures over HHS identities.


## Mesh network

A peer in the HHS mesh network is a pair containing an identity (i.e. a typed identity object per the data model above) and an HTTP endpoint. The in-browser networking used by HHS is based on [WebRTC](https://webrtc.org/). While this allows direct browser-to-browser data streams, WebRTC connection establishment needs the two parties to exchange a few messages out-of-band, using a signalling server. We have developed a [tiny service](https://github.com/hyperhyperspace/hyperhyperspace-signalling) (77 lines of python at the moment). While everyone can run their own, we are providing a public instance running at the URL `wss://mypeer.net:443`. To listen for peer connections, the browser will form an HTTP endpoint using the signalling server URL and some arbitrary information (usually involving its identity hash, but that is determined by the app), and connect to the signalling server over a websocket. To connect to another peer, the browser will open a websocket to the other peer's signalling server. Two peers don't need to use the same signalling server to be able to connect.

Peer groups use simple randomized algorithms to choose how peers interconnect to each other within the group, epidemic gossip to figure any new state, and cryptographically secured deltas to send missing operations back and forth.

Apps will configure groups of peers, and the HHS mesh provides primitves for effortlessly synchronizing objects within each peer group (this boils down to syncrhonizing their sets of CRDT operations for each shared object).


## Project status

There is a demo of a simple fully in-browser p2p chat app running [here](https://hyperhper.space). However, the library has been fully rewritten since that demo was created.

Re-wiring the demo to use the current version of the library is currently WIP. Check out the `Account` library in the next section.


## Libraries

 - [Account](https://github.com/hyperhyperspace/hyperhyperspace-account): This library allows your app to creates a personal cloud using all your devices, based on your HHS identity, and syncrhonizing information across them using the HHS store. It also allows you to add other HHS identities to a personal `Contacts` list, and slectively share information with them through mingling your and one of your contacts' devices (forming a shared cloud just for you two).

 __More libraries to come.__
