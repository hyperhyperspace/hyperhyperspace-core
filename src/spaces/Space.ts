import { HashedObject, Resources } from "data/model";
import { PeerGroup } from "mesh/service";


type SpaceHashKey = { 
    type:'full'|'partial', 
    hash: string
};

class Space {

    key: SpaceHashKey;
    resources: Resources;

    initialPeers?: PeerGroup;
    root?: HashedObject;


    constructor(key: SpaceHashKey, resources: Resources) {
        this.key = key;
        this.resources = resources;
    }

    


}

export { Space };