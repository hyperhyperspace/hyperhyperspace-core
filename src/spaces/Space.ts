import { HashedObject, HashReference, Resources } from 'data/model';
import { PeerGroup } from 'mesh/service';

class Space {

    rootHashRef?: HashReference<HashedObject>;
    initialPeers?: PeerGroup;
    
    
    root?: HashedObject;

    resources: Resources;

    constructor(rootHashRef: HashReference<HashedObject>, initialPeers: PeerGroup, resources: Resources) {
        this.rootHashRef = rootHashRef;
        this.initialPeers = initialPeers;
        this.resources = resources;
    }

}

export { Space };