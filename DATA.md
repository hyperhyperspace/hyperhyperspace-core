# Data model

## Intro

An HHS application persists data into a local store, that is similar to a key-value store. It uses a well defined data model that imposes some constraints on the information being saved, with the intention of making synchronization with other stores in HHS's [p2p mesh](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/MESH.md) possible.

The store is implemented in [src/data/storage/Store.ts](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/storage/Store.ts). It works as an object store, and is type-aware. This enables it to perform same basic sanity checks on the data it is receiving, based on the type it is expecting.

Note: to try these examples out, you need to install Hyper Hyper Space's core library.

### Content-based addressing

Stored objects can be retrieved from the store by using a hash of their contents as the key.

To indicate a given class is meant to be stored, a base class [HashedObject](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/model/HashedObject.ts) is provided. Take a look at the example below (to work around Typescript type erasure on compilation, we'll add some explicit type information).

```js
import { Hash, HashedObject } from '@hyper-hyper-space/core';

class Person extends HashedObject {

    static className = 'hhs-example/Person';

    name?: string;
    birthday?: number;

    constructor(name?: string, age?: number) {
        this.name = name;
        this.age  = age;
    }

    init() {
        // no initialization needed
    }

    validate(_references: Map<Hash, HashedObject>) {
        return (typeof this.name) === string && (typeof this.age) === number;
    }

    getClassName() {
        return Person.className;
    }
}

ClassRegistry.register(Person.className, Person);
```

Notice that Typescript's compile time checks are not very helpful in this scenario: we want to be able to share instances of ```Person``` with untrusted peers, so we need to validate them in runtime as they are received. In this case, we are making the instance members ```name``` and ```birthday``` mandatory. The store will refuse to accept an instance of ```Person``` whose contents do not comply to its ```validate``` method. We're also declaring a meta-type name ```hhs-example/Person``` and later declaring that Person is our implementation for that type. The peer on the other end of the network may be using another implementation of this ```hhs-example/Person``` meta-type, and this explicit declaration enables interoperation.

If this library is implemented using a programming language with a richer type system in the future, some of these annotations could be automatically derived.

Let's see an example of using our ```Person``` type and a local Store backed by the default storage backend (which is IndexedDB-based, for use in the browser):

```js
import { Store, IdbBackend } from 'hhs';
import { Person } from './Person';

let p = new Person('Dr. Strangelove', new Date('1950-11-03').getTime());

p.hash();
// '9a8232a0b899234c'

let store = new Store(new IdbBackend('my-store'));

store.save(p);

let p2 = store.load('9a8232a0b899234c') as Person;

p.equals(p2);
// true
```

Stored types can be nested:

```js
class Country extends HashedObject {
    president?: Person;

    // ...

    validate(_references: Map<Hash, HashedObject>) {
        return this.president !== undefined && this.president instanceof Person;
    }
```

In the example above, a given person would be stored only once in the store, and the ```president``` instance member above would be just a typed reference to its hash.

### Mutability

However, what we've described so far presents a problem: while we can modify any of these objects and store it again, that would also change the object's hash. Therefore, we'd be creating a second, independent object in the store.

To cope with mutability, HHS uses operation-based [CRDT](https://crdt.tech/)s. To this effect, a [MutableObject](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/model/MutableObject.ts) base class is introduced. Types derived from ```MutableObject``` create operation objects as they change, that are in themselves also immutable, and save these operations to the store. The properties of CRDTs ensure us that, if operations on the same object are created concurrently by several peers on HHS, the final state of the object will be the same on all peers, no matter when or how the operations reach them.

You can see examples of a [MutableReference](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/collections/mutable/MutableReference.ts) and a [MutableSet](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/collections/mutable/MutableSet.ts) in the [colletions/mutable](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/collections/mutable) folder in the source.

Our ```Country``` implementation would look like this now:

```js
class Country extends HashedObject {
    president?: MutableReference<Person>;

    // ...
```

And we could write code like this:

```js
let hash   = '2a77810ab9df';
let argentina = store.load(hash);;
let charly = new Person('Carlos García', );

argentina.president.setValue(charly);
// Now argentina.president has an operation pending storage.

argentina.save();
// This saves the op setting the value of argentina.president to charly.
```

### Identity and authentication

HHS has a native [Identity](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/identity/Identity.ts) implementation, that combines a public key with optional immutable information about its holder. It conforms to the ```HashedObject``` type described above:

```js
import { Identity, RSAKeyPair } from { hhs };

let kp = RSAKeyPair.create(2048);
let me = Identity.fromKeyPair({name: 'Santi'}, kp);

console.log('my identity is ' + me.hash());

store.save(me);

```

Object authorship is established and verified using identities:

```js
let ms = new MutableSet<Person>();

ms.setAuthor(me);

store.save(ms);
```

### Summary

Summing up, in order to enable the eventual sharing and synchronizing of local data, the HHS store follows the following considerations:

 - **The store saves only typed objects.** This allows performing basic semantic validation when new information is received from untrusted sources.
 - **Objects are retrieved using content-based addressing.** HHS provides a standard way to hash objects, and these hashes are the only way to refer to them. The store works as a key-value store, with hashes as keys, and objects are thus immutable.
 - **Objects can reference each other explicitly using their hashes.** Objects and their references thus form an immutable append-only DAG.
 - **Mutability is modelled through operational [CRDT](https://crdt.tech/)s.** Mutation ops are also represented as objects in the store. The type of the object determines how the operations will be interpreted, and how to derive state from them.
 - **Identities are cryptographic.** HHS identities combine a public key with optional information about its holder. They are represented as an object in the store, and are referenced by their hash.
 - **Data validation / authentication is cryptographic.** Object authorship within the store is implemented using hashing and signatures over HHS identities.
