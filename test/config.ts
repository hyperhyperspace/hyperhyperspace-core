import '@hyper-hyper-space/node-env';
import { WebCryptoConfig } from 'crypto/config';

const { Crypto } = require("@peculiar/webcrypto");

const crypto = new Crypto();

WebCryptoConfig.overrideImpl = crypto.subtle;

let describeProxy = describe;

export { describeProxy };