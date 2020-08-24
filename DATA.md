# Data model

## Intro

An HHS application persists data into a local store, that is similar to a key-value store. It uses a well defined data model that imposes some constraints on the information being saved, with the intention of making synchronization with other stores in HHS's [p2p mesh](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/MESH.md) possible. 

The store is implemented in [src/data/storage/Store.ts](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/storage/Store.ts). It works as an object store, and is type-aware. This enables the store to perform same basic sanity checks on the data it is receiving, and the type it is expecting. 

### Content-based addressing

Stored objects can be retreived from the store by using a hash of their contents. 

To indicate a given class is meant to be stored, it should extend [HashedObject](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/model/HashedObject.ts). Take a look at the example below. To work around Typescript type erasure on compilation, we'll add some explicit type information.

```
import { Hash, HashedObject } from 'hhs';

class Person extends HashedObject {

    static className = 'hhs-exaple/Person';

    name?: string;
    birthday?: number;

    constructor(name?: string, age?: number) {
        this.name = name;
        this.age  = age;
    }

    init() {
        // no intialization needed
    }

    validate(_references: Map<Hash, HashedObject>) {
        return this.name !== undefined && age !== undefined;
    }

    getClassName() {
        return Person.className;
    }
}

HashedObject.registerClass(Person.className, Person);
```

Notice that Typescript's compile time checks are not very helpful in this scenario: we want to be able to send and receive instances of ```Person``` over the network, so we need to validate them in runtime. In this case, we are making the instance members ```name``` and ```birthday``` mandatory. The store will refuse to accept an instance of ```Person``` whose contents do not comply to its ```validate``` method. We're also declaring a meta-type name ```hhs-exaple/Person``` and later declaring that Person is our implementation for that type. The peer on the other end of the network may be using another implementation of this ```hhs-exaple/Person``` meta-type, and its explicit declaration enables interoperation.

If this library is implemented using a programming language with a richer type system, some of this annotations could be automatically derived.

Let's see an exaple using our ```Person``` type and a local Store backed by the default HHS storage backend (which is IndexedDB-based, from use in the browser):

```
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

```
class Country extends HashedObject {
    president?: Person;

    // ...

    validate(_references: Map<Hash, HashedObject>) {
        return this.president !== undefined && this.president instanceof Person;
    }
```

In the example above, a given person would be stored only once in the store, and the ```president``` instance member above would be just a typed reference to its hash.

### Mutability

However, what we've described so far presents a problem: while we can modify any of these objects and store it again, that would also change the object's hash. Therefore, we'd be creating a second, independnent object in the store.

To cope with mutability, HHS uses operation-based [CRDT](https://crdt.tech/)s. To this effect, a [MutableObject](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/model/MutableObject.ts) base class is instroduced. Types derived from ```MutableObject``` create operation objects as they change, that are in themselves also immutable, and save these operations to the store. The properties of CRDTs ensure us that, if operations on the same object are created concurrently by several peers on HHS, the final state of the object will be the same on all peers, no matter when or how the operations reach them.

You can see examples of a [MutableReference](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/containers/MutableReference.ts) and a [MutableSet](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/containers/MutableSet.ts) in the [containers](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/containers/) folder in the source.

Our ```Country``` implementation would look like this now:

```
class Country extends HashedObject {
    president?: MutableReference<Person>;

    // ...
```

And we could write code like this:

```
let hash   = '2a77810ab9df';
let argentina = store.load(hash);;
let charly = new Person('Carlos García', );

argentina.president.setValue(charly);
// Now argentina.president has an operation pending storage.

argentina.save();
// This saves the op setting hte value of argentina.president to charly.
```

### Identity and authentication

HHS has a native [Identity](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/identity/Identity.ts) implementation, that combines a public key with optional immutable information about its holder. It conforms to the ```HashedObject``` type described above:

```
import { Identity, RSAKeyPair } from { hhs };

let kp = RSAKeyPair.create(2048);
let me = Identity.fromKeyPair({name: 'Santi'}, kp);

console.log('my identity is ' + me.hash());

store.save(me);

```

Object authorship is established an verified using identities:

```
let ms = new MutableSet<Person>();

ms.setAuthor(me);

store.save(ms);
```

### Summary

Summing up, in oder too enable the eventual sharing and synchronizing of local data, the HHS store follows the following considerations:

 - **The store saves only typed objects.** This allows performing basic semantic validation when new information is received from untrusted sources.
 - **Objects are retrieved using content-based addressing.** HHS provides a standard way to hash objects, and these hashes are the only way to refer to them. The store works as a key-value store, with hashes as keys, and objects are thus immutable.
 - **Objects can reference each other explicitly using their hashes.** Objects and their references thus form an immutable append-only DAG.
 - **Mutability is modelled through operational [CRDT](https://crdt.tech/)s.** Mutation ops are also represented as objects in the store. The type of the object determines how the operations will be interpeted, and how to derive state from them. 
 - **Identities are cryptographic.** HHS identities combine a public key with optional infornation about its holder. They are represented as an object in the store, and are referenced by their hash.
 - **Data validation / authentication is cryptographic.** Object authorship within the store is implemented using hashing and signatures over HHS identities.