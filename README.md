The Hyper Hyper Space attempts to be an internet-scale distributed database that enables the development of new interoperable collaboration platforms.

The Internet allows applications to operate as if all clients were connected to a single huge global network, while in practice they are connected to small independent networks that interoperate over a set of well defined internet protocols. It works so beautifully it is easy to forget that, in the times before the Internet, people could only interact with parties that where connected to the same network.

Yet, the information we store online does not enjoy any degree of interoperability. Our social network profiles and posts, pictures, professional resumes, marketplace listings, etc. are hosted inside platforms that, while being globally accessible over the Internet, don't make this information portable or accessible through other tools of your choosing. Only the presentation of this information, thanks to protocols and standards like HTTP and HTML, is uniformly accessible through web browsers.

This library, when included in any static webpage, transforms any standards compliant modern browser (Mozilla or Chrome at the moment) in a peer that can operate and communicate through this global databse.

Users of this database identify themselves using asymmetric cryptography keys, and create information nodes that are cryptographically sigend and reference each other using content-based addressing, thus forming an immutable DAG. Mutable information is represented operationally over the DAG, using CRDTs or other suitable means.

Peers self-organize into swarms that operate over specific branches or connected components of the DAG, using specific rules or protocols that enable them to collaborate to perform a common goal (that could be a discussion forum, a marketplace, a workplace collaboration solution - anything that requires collaboration).

Ideally, programming such an application does not require knowing the inner workings of the Hyper Hyper Space. An API spanning concepts and abstractions similar to those found in a regular database should be availabe.

Users accessing a website that has the Hyper Hyper Space as its back-end should not feel any difference respective to websites built using traditional stacks (besides some specific issues, e.g. having to link their H.H.S. identity to this website).