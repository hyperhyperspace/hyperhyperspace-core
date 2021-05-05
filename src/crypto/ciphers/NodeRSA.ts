import { NodeRSASigKP } from 'crypto/sign/NodeRSASigKP';
import { NodeRSAEncKP } from './NodeRSAEncKP';

import { DelegatingRSAImpl } from './DelegatingRSAImpl';
import { RSA } from './RSA';


class NodeRSA extends DelegatingRSAImpl implements RSA {

    constructor() {
        super(new NodeRSAEncKP(), new NodeRSASigKP());
    }

}

export { NodeRSA };