import { ChaCha20Impl } from 'crypto/ciphers';
import { SHAImpl } from 'crypto/hashing';
import { HMACImpl } from 'crypto/hmac';
import { LinkupAddress } from 'net/linkup';
import { PeerInfo } from '../PeerGroupAgent';
import { PeerSource } from '../PeerSource';

/* Takes a secret string and a pre-existing peer source, and masks all linkupIds
 *  (the portion of the URL that comes after the hostname) using the secret.
 *
 * It does it by computing an small HMAC for the linkupID (48 bits) and appending  
 * it to the endpoint before encrypting (both using the provided secret).
 * 
 * To validate an endpoint, it decrypts it and verifies the hmac, and only then it
 * checks with the pre-existing peer source.
 * 
 * This way, only folks knowing the secret can join the peer group.
 */

 const HMAC_NIBBLES = 12;

class SecretBasedPeerSource implements PeerSource {

    peers: PeerSource;
    secret: string

    static maskEndpoint(endpoint: string, secret: string): string {

        const addr = LinkupAddress.fromURL(endpoint);

        let hmac = new HMACImpl().hmacSHA256hex(addr.linkupId, secret).slice(-HMAC_NIBBLES);
        let key   = new SHAImpl().sha256hex(secret);
        let nonce = new SHAImpl().sha256hex(key).slice(-24);
        
        let linkupId = new ChaCha20Impl().encryptHex(addr.linkupId + hmac, key, nonce);

        return  new LinkupAddress(addr.serverURL, linkupId).url();
    }

    static unmaskEndpoint(endpoint: string, secret: string): string | undefined {

        const addr = LinkupAddress.fromURL(endpoint);

        let result: string | undefined = undefined;

        try {
            let key   = new SHAImpl().sha256hex(secret);
            let nonce = new SHAImpl().sha256hex(key).slice(-24);

            let clear = new ChaCha20Impl().decryptHex(addr.linkupId, key, nonce);
            let hmac  = clear.slice(-HMAC_NIBBLES);
            let linkupId = clear.slice(0, -HMAC_NIBBLES);

            if (hmac === new HMACImpl().hmacSHA256hex(linkupId, secret).slice(-HMAC_NIBBLES)) {
                result = linkupId;
            }
        } catch (e) {

        }

        return result;

    }


    constructor(peers: PeerSource, secret: string) {
        this.peers = peers;
        this.secret = secret;
    }

    async getPeers(count: number): Promise<PeerInfo[]> {
        let result = [];

        for (const peer of await this.peers.getPeers(count)) {

            const newEndpoint = SecretBasedPeerSource.maskEndpoint(peer.endpoint, this.secret);

            const newPeer: PeerInfo = {
                endpoint: newEndpoint,
                identityHash: peer.identityHash
            }

            if (peer.identity !== undefined) {
                newPeer.identity = peer.identity;
            }

            result.push(newPeer);
        }

        return result;
    }

    async getPeerForEndpoint(endpoint: string): Promise<PeerInfo | undefined> {
        
        let result: PeerInfo | undefined = undefined;

        const unmasked = SecretBasedPeerSource.unmaskEndpoint(endpoint, this.secret);

        if (unmasked !== undefined) {
            result = await this.peers.getPeerForEndpoint(unmasked);
        }

        return result;
    }

}

export { SecretBasedPeerSource };