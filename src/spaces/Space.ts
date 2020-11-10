import { RNGImpl } from 'crypto/random';
import { WordCode } from 'crypto/wordcoding';
import { Hash, HashedObject, Hashing, Resources } from 'data/model';
import { ObjectDiscoveryReply } from 'mesh/agents/discovery';
import { Endpoint } from 'mesh/agents/network';
import { LinkupAddress, LinkupManager } from 'net/linkup';
import { AsyncStream } from 'util/streams';
import { SpaceEntryPoint } from './SpaceEntryPoint';

type SpaceInit = {entryPoint?: HashedObject & SpaceEntryPoint, hash?: Hash, wordCode?: string[], wordCodeLang?: string };

class Space {

    static fromEntryPoint(obj: HashedObject & SpaceEntryPoint, resources: Resources, localEndpoint: Endpoint, linkupServers?: string[]): Space {
        return new Space({entryPoint: obj}, resources, localEndpoint, linkupServers);
    }

    static fromHash(hash: Hash, resources: Resources, localEndpoint: Endpoint, linkupServers?: string[]): Space {
        return new Space({hash: hash}, resources, localEndpoint, linkupServers);
    }

    static fromWordCode(words: string[], resources: Resources, localEndpoint: Endpoint, linkupServers?: string[]): Space {
        return new Space({wordCode: words}, resources, localEndpoint, linkupServers);
    }


    entryPoint: Promise<HashedObject & SpaceEntryPoint>;
    linkupServers: string[];
    localEndpoint: Endpoint;
    resources: Resources;

    discovery?: AsyncStream<ObjectDiscoveryReply>;

    constructor(init: SpaceInit, resources: Resources, localEndpoint?: Endpoint, linkupServers?: string[]) {

        this.resources = resources;
        this.linkupServers = linkupServers || [LinkupManager.defaultLinkupServer];
        this.localEndpoint = localEndpoint || new LinkupAddress(this.linkupServers[0], new RNGImpl().randomHexString(128)).url();

        if (init.entryPoint !== undefined) {
            this.entryPoint = Promise.resolve(init.entryPoint);
        } else if (init.hash !== undefined) {
            this.discovery = 
                this.resources.mesh.findObjectByHash(init.hash, this.linkupServers, this.localEndpoint);
            this.entryPoint = this.processDiscoveryReply(this.discovery);
        } else if (init.wordCode !== undefined) {

            let wordCoders: WordCode[];

            if (init.wordCodeLang !== undefined) {
                if (WordCode.lang.has(init.wordCodeLang)) {
                    wordCoders = [WordCode.lang.get(init.wordCodeLang) as WordCode];
                } else {
                    throw new Error('Unknown language "' + init.wordCodeLang + '" received for decoding wordCode ' + init.wordCode.join('-') + '.');
                }
                
            } else {
                wordCoders = WordCode.all;
            }

            let suffix: string|undefined;
            let lastError: Error|undefined;

            for (const wordCoder of wordCoders) {
                try {
                    suffix = wordCoder.decode(init.wordCode);
                    break;
                } catch (e) {
                    lastError = e;
                }
            }

            if (suffix === undefined) {
                throw new Error('Could not decode wordCode ' + init.wordCode.join(' ') + ', last error: ' + lastError);
            }

            this.discovery =
                this.resources.mesh.findObjectByHashSuffix(suffix, this.linkupServers, this.localEndpoint);
            this.entryPoint = this.processDiscoveryReply(this.discovery);
        } else {
            throw new Error('Created new space, but no initialization was provided (entry object nor hash no word code).');
        }
    }

    private processDiscoveryReply(discoveryStream: AsyncStream<ObjectDiscoveryReply>): Promise<HashedObject & SpaceEntryPoint> {
        return new Promise((resolve: (value?: (HashedObject & SpaceEntryPoint)) => void, reject: (reason: 'timeout'|'end') => void) => {

            discoveryStream.next(30000).then((reply: ObjectDiscoveryReply) => {
                resolve(reply.object as (HashedObject & SpaceEntryPoint));
            }).catch((reason: any) => {
                reject(reason);
            });
        
        });
    }

    async getEntryPoint(): Promise<HashedObject & SpaceEntryPoint> {
        return this.entryPoint;
    }

    async getHash(): Promise<Hash> {
        let entry = await this.entryPoint;
        return entry.hash();
    }

    async getWordCoding(words=3, lang='en'): Promise<string[]> {
        let hash = await this.getHash();
        let coder = WordCode.lang.get(lang);

        if (coder === undefined) {
            throw new Error('Could not find word coder for language ' + lang + '.');
        }


        const nibbles = coder.bitsPerWord * words / 4;

        const suffix = Hashing.toHex(hash).slice(-nibbles);

        return coder.encode(suffix)
    }

    startBroadcast() {
        this.entryPoint.then((ep: HashedObject & SpaceEntryPoint) => {
            this.resources.mesh.startObjectBroadcast(ep, this.linkupServers, [this.localEndpoint]);
        });
        
    }

    stopBroadcast() {
        this.entryPoint.then((ep: HashedObject & SpaceEntryPoint) => {
            this.resources.mesh.stopObjectBroadcast(ep.hash());
        })
    }

}

export { Space };