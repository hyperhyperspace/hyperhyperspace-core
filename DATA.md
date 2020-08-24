An HHS application persists data into a local store, that is similar to a key-value store. It uses a well defined data model that imposes some constraints on the information being saved, with the intention of making synchronization with other stores in HHS's [p2p mesh](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/MESH.md) possible. 

The store is implemented in [src/data/storage/Store.ts](https://github.com/hyperhyperspace/hyperhyperspace-core/blob/master/src/data/storage/Store.ts). It works as an object store, and is type-aware. This enables the store to perform same basic sanity checks on the data it is receiving, and the type it is expecting. 

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

Notice that Typescript's compile time checks are not very helpful in this scenario: we want to be able to send and receive instances of ```Person``` over the network, so we need to validate them in runtime. In this case, we are making the instance members ```name``` and ```birthday``` mandatory. We're also declaring an meta-type name ```hhs-exaple/Person``` and later declaring that Person is our implementation for that type. The peer on the other end of the network may be using another implementation of this ```hhs-exaple/Person```. If this library is implemented using a programming language with a richer type system, some of this annotations could be automatically derived.

Let's see an exaple using our ```Person``` type:

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

To enable the eventual sharing and synchronizing of local data, the HHS store follows the following considerations:

 - **The store saves only typed objects.** This allows performing basic semantic validation when new information is received from untrusted sources.
 - **Objects are retrieved using content-based addressing.** HHS provides a standard way to hash objects, and these hashes are the only way to refer to them. The store works as a key-value store, with hashes as keys, and objects are thus immutable.
 - **Objects can reference each other explicitly using their hashes.** Objects and their references thus form an immutable append-only DAG.
 - **Mutability is modelled through operational [CRDT](https://crdt.tech/)s.** Mutation ops are also represented as objects in the store. The type of the object determines how the operations will be interpeted, and how to derive state from them. 
 - **Identities are cryptographic.** HHS identities combine a public key with optional infornation about its holder. They are represented as an object in the store, and are referenced by their hash.
 - **Data validation / authentication is cryptographic.** Object authorship within the store is implemented using hashing and signatures over HHS identities.