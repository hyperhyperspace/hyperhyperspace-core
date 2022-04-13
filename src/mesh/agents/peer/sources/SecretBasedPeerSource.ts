import { ChaCha20Impl } from 'crypto/ciphers';
import { HMACImpl } from 'crypto/hmac';
import { RNGImpl } from 'crypto/random';
import { Endpoint } from 'mesh/agents/network';
import { LinkupAddress } from 'net/linkup';
import { PeerInfo } from '../PeerGroupAgent';
import { PeerSource } from '../PeerSource';

/* Takes a secret string and a pre-existing peer source, and masks all linkupIds
 *  (the portion of the URL that comes after the hostname) using the secret.
 *
 * The secret should be a 32 bytes hexadecimal number (64 nibbles).
 *
 * It does it by computing an HMAC for the linkupID and appending  
 * it to the endpoint before encrypting (both using the provided secret).
 * 
 * To validate an endpoint, it decrypts it and verifies the hmac, and only then it
 * checks with the pre-existing peer source.
 * 
 * A random nonce is used and appended to the endpoint, so the mapping from endpoints
 * to encrypted endpoints is not deterministic (*).
 * 
 * The result is that only folks knowing the secret can join the peer group.
 *
 * (*) As shown in the diagram below, when receiving an endpoint over the network it is
 * decrypted, passed to the underlying PeerSource that provides a peer, and then the
 * peer's endpoint is re-encrypted. In this case, the nonce is smuggled into a field in the 
 * peer structure, so it can be used when re-encrypting the peer on the way back.
 * 
 */

/*
 *   PeerGroupAgent <-- getPeers() -- SecretBasedPeerSource <-- getPeers() -- PeerSource
 *         |                           <encrypts endpoint A>
 *         |
 *         |
 *  _______|_____________________________________________Network_________________________
 *         | Connection
 *         |  request to:     encrypted endpoint A
 *         |        from:     encrypted endpoint B
 *         |
 *         V
 *   PeerGroupAgent -- getPeerForEndpoint(B) --> SecretBasedPeerSource ______ 
 *         A                                     <decrypts endpoint B>       | 
 *         |                                                                 | 
 *         |                                                  getPeerForEndpoint(decr. B) 
 *         |                                                                 | 
 *         |                                                                 V
 *         |                                                            PeerSource 
 *         |                                                                 |
 *         |                                                                 | 
 *         |                                                                 | 
 *         ----------------------------------------SecretBasedPeerSource_____|
 *                                             <re-encrypts endp. B in peer>
 */ 
 
const KEY_NIBBLES = 64;
const HMAC_NIBBLES = 64;
const NONCE_NIBBLES = 24;

class SecretBasedPeerSource implements PeerSource {

    peers: PeerSource;
    secretHex: string

    static encryptPeer(peer: PeerInfo, secretHex: string, nonce?: string): PeerInfo {

        const secretPeer: PeerInfo = {
            endpoint: SecretBasedPeerSource.encryptEndpoint(peer.endpoint, secretHex, nonce),
            identityHash: peer.identityHash,
            identity: peer.identity
        };

        return secretPeer;
    }

    static decryptPeer(peer: PeerInfo|undefined, secretHex: string): PeerInfo|undefined {

        if (peer === undefined) {
            return undefined;
        }

        const unmaskedEndpoint = SecretBasedPeerSource.decryptEndpoint(peer.endpoint, secretHex);

        if (unmaskedEndpoint === undefined) {
            return undefined;
        } else {
            return {
                endpoint: unmaskedEndpoint,
                identityHash: peer.identityHash,
                identity: peer.identity
            } as any;
        }

    }

    static encryptEndpoint(endpoint: string, secretHex: string, nonce?: string): string {


        const rng = new RNGImpl();

        const addr = LinkupAddress.fromURL(endpoint);

        const key   = secretHex;
        const hmac  = new HMACImpl().hmacSHA256hex(addr.linkupId, key);
        
        if (nonce === undefined) {
            nonce = rng.randomHexString(96);
        }

        const linkupId = new ChaCha20Impl().encryptHex(addr.linkupId + hmac, key, nonce) + nonce;

        const result = new LinkupAddress(addr.serverURL, linkupId).url();

        return result;
    }

    static decryptEndpoint(endpoint: string, secretHex: string): string | undefined {

        const addr = LinkupAddress.fromURL(endpoint);

        try {
            const key    = secretHex;
            const nonce  = addr.linkupId.slice(-NONCE_NIBBLES);
            const cypher = addr.linkupId.substring(0, addr.linkupId.length-NONCE_NIBBLES);
            const clear  = new ChaCha20Impl().decryptHex(cypher, key, nonce);
            const hmac   = clear.slice(-HMAC_NIBBLES);
            const linkupId = clear.substring(0, clear.length-HMAC_NIBBLES);

            if (hmac === new HMACImpl().hmacSHA256hex(linkupId, key)) {
                const result = new LinkupAddress(addr.serverURL, linkupId).url();
                return result;
            }
        } catch (e) {

        }

        return undefined;        

    }

    static makeSecureEndpointParser(parser: (ep: Endpoint) => Promise<PeerInfo|undefined>, secretHex: string) {
        return async (ep: Endpoint) => {
            const plain = SecretBasedPeerSource.decryptEndpoint(ep, secretHex);
            if (plain !== undefined) {
                const peer = await parser(plain);
                if (peer !== undefined) {
                    (peer as any).nonce = ep.slice(-NONCE_NIBBLES);
                    const result = SecretBasedPeerSource.encryptPeer(peer, secretHex, ep.slice(-NONCE_NIBBLES));
                    return result;
                }
            }
            return undefined;
        };
    }

    constructor(peers: PeerSource, secretHex: string) {

        if (secretHex.length !== KEY_NIBBLES) {
            throw new Error('The key provided to a SecretBasedPeerSource should be ' + KEY_NIBBLES*2 + ' bytes long.');
        }

        this.peers = peers;
        this.secretHex = secretHex;
    }

    makeSecretPeer(peer: PeerInfo, nonce?: string): PeerInfo {

        return SecretBasedPeerSource.encryptPeer(peer, this.secretHex, nonce);
    }

    async getPeers(count: number): Promise<PeerInfo[]> {
        let result = [];

        let peers = await this.peers.getPeers(count);

        for (const peer of peers) {

            const newEndpoint = SecretBasedPeerSource.encryptEndpoint(peer.endpoint, this.secretHex, (peer as any)?.nonce);

            if (newEndpoint !== undefined) {
                const newPeer: PeerInfo = {
                    endpoint: newEndpoint,
                    identityHash: peer.identityHash
                }
    
                if (peer.identity !== undefined) {
                    newPeer.identity = peer.identity;
                }
    
                result.push(newPeer);
            }

        }

        return result;
    }

    async getPeerForEndpoint(endpoint: string): Promise<PeerInfo | undefined> {

        const unmasked = SecretBasedPeerSource.decryptEndpoint(endpoint, this.secretHex);
        if (unmasked !== undefined) {
            const unmaskedPeer = await this.peers.getPeerForEndpoint(endpoint);
            if (unmaskedPeer !== undefined) {
                const masked = this.makeSecretPeer(unmaskedPeer, endpoint.slice(-NONCE_NIBBLES));
                return masked;
            }
        }
        
        return undefined;
    }

}

export { SecretBasedPeerSource };