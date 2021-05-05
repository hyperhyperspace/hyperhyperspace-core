import { WebCryptoRSASigKP } from 'crypto/sign/WebCryptoRSASigKP';
import { WebCryptoRSAEncKP } from './WebCryptoRSAEncKP';

import { DelegatingRSAImpl } from './DelegatingRSAImpl';
import { RSA } from './RSA';


class WebCryptoRSA extends DelegatingRSAImpl implements RSA {

    constructor() {
        super(new WebCryptoRSAEncKP(), new WebCryptoRSASigKP);
    }

}

export { WebCryptoRSA };