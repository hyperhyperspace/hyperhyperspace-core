# The Hyper Hyper Space core library  


> An offline-first shared data library for creating p2p apps that work in the browser (and now also nodejs).  

## TLDR

This library helps you create distributed data structures, mostly for p2p applications. It works like an object store, where objects have to follow some conventions to enable secure remote sync. You can see an example [here](https://github.com/hyperhyperspace/examples/blob/master/src/chat/model/ChatRoom.ts). More info (including how to run the examlpe) [below](#examples).

## Intro

In the same way in which the Internet bridges networks together, the HHS attempts to decouple data from the apps used to manage it, thus enabling individuals to have better ownership and control over their information.

Apps that use the HHS model store information locally (the current implementation works in a modern web browser, effectively turning it into an autonomus node in a p2p network).

Apps will most of the time work on the local store as if it were universal (i.e. a magic database that contains all the needed information from everybody). The HHS library contains networking primitives that allow apps to form ad-hoc groups of peers that make the necessary information flow from one local store to another. Usually each app module can be split in two, cleanly separating all the information handling from the synchronization logic.

**This project is experimental. All APIs may change, bugs exist and the crypto has not been audited.**

## Examples

To create datatypes that can be shared using HHS, you need to extend the `HashedObject` and `MutableObject` classes. You can learn more on the [Data Model](#data-model) section below,
or jump to a few examples in [this repo](https://github.com/hyperhyperspace/examples).

To run the example chat app, clone the examples repo and do

`yarn build`

`yarn start`

If you're using windows, replace `start` by `winstart` above.

## Objectives

Enable the creation of p2p apps that work in-browser, without requiring _any_ infrastructure, and that are as practical and functional as centralized apps. Find abstractions and algorithms that make creating and reasoning about these apps intuitive and predictable. Explore new models for online collaboration platforms that follow the p2p model yet are frictionless to use for the general public, and are

- respectful of everyone's privacy and data ownership rights
- transparent in their handling of information

by default.

## Data model

HHS uses an immutable typed-objects local storage model. Objects are both retreived and cross-referenced using a structural hash of their contents as their id (a form of content-based addressing).

Mutability is implemented using [CRDT](https://crdt.tech/)s. Identities and data authentication are cryptographic.

Objects and their references form an immutable DAG, a fact that is used for data replication in HHS p2p mesh.

You can read more about HHS data model, including code samples, [here](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/DATA.md).


## Mesh network

A peer in the HHS mesh network is a pair containing an identity (i.e. a typed identity object per the data model above) and an endpoint (URL). The in-browser networking used by HHS is based on [WebRTC](https://webrtc.org/). While this allows direct browser-to-browser data streams, WebRTC connection establishment needs the two parties to exchange a few messages out-of-band, using a signalling server. We have developed a [tiny service](https://github.com/hyperhyperspace/hyperhyperspace-signalling) (77 lines of python at the moment). While everyone can run their own, we are providing a public instance running at the URL `wss://mypeer.net:443`. To listen for peer connections, the browser will form an endpoint using the signalling server URL and some arbitrary information (usually involving its identity hash, but that is determined by the app), and connect to the signalling server over a websocket. To connect to another peer, the browser will open a websocket to the other peer's signalling server. Two peers don't need to use the same signalling server to be able to connect.

Peer groups use simple randomized algorithms to choose how peers interconnect to each other within the group, epidemic gossip to discover any new state, and cryptographically secured deltas to send missing operations back and forth.

Apps will configure groups of peers, and the HHS mesh provides primitives for effortlessly synchronizing objects within each peer group (this boils down to syncrhonizing their sets of CRDT operations for each shared object).


## Spaces

A [space](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/spaces/Space.ts) is a data unit that can be shared and discovered easily. It has root object that can be used to bootstrap and synchronize the space.

## Project status

There is a demo of a simple fully in-browser p2p chat app running [here](https://hyperhyper.space). However, the library has been fully rewritten since that demo was created.

Re-wiring the demo to use the current version of the library is currently WIP. Check out the `Account` library in the next section.

## Using outside the browser

If you need to use this library directly in NodeJs, outside of a web browser, you need to import [@hyper-hyper-space/node-env](https://www.npmjs.com/package/@hyper-hyper-space/node-env).
