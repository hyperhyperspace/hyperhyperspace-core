import { WordCode } from 'crypto/wordcoding';
import { Hash, HashedObject, Hashing } from 'data/model';
import { ObjectDiscoveryReply } from 'mesh/agents/discovery';
import { AsyncStream } from 'util/streams';
import { SpaceEntryPoint } from './SpaceEntryPoint';
import { Resources } from './Resources';

type SpaceInit = {entryPoint?: HashedObject & SpaceEntryPoint, hash?: Hash, wordCode?: string[], wordCodeLang?: string };

class Space {

    static fromEntryPoint(obj: HashedObject & SpaceEntryPoint, resources: Resources): Space {
        return new Space({entryPoint: obj}, resources);
    }

    static fromHash(hash: Hash, resources: Resources): Space {
        return new Space({hash: hash}, resources);
    }

    static fromWordCode(words: string[], resources: Resources): Space {
        return new Space({wordCode: words}, resources);
    }


    entryPoint: Promise<HashedObject & SpaceEntryPoint>;
    //linkupServers: string[];
    //discoveryEndpoint: Promise<Endpoint>;
    resources: Resources;

    discovery?: AsyncStream<ObjectDiscoveryReply>;

    constructor(init: SpaceInit, resources: Resources) {

        this.resources = resources;

        if (init.entryPoint !== undefined) {
            this.entryPoint = Promise.resolve(init.entryPoint);
        } else if (init.hash !== undefined) {

            this.entryPoint = this.resources.store.load(init.hash).then((obj: HashedObject | undefined) => {
                if (obj !== undefined) {
                    return obj as HashedObject & SpaceEntryPoint;
                } else {
                    if (resources.config.peersForDiscovery === undefined) {
                        throw new Error('Trying to open space for missing object ' + init.hash + ', but config.peersForDiscovery is undefined.');
                    }

                    const linkupServers = resources.config.linkupServers;
                    const discoveryEndpoint = resources.config.peersForDiscovery[0].endpoint;
            
                    const discovery = 
                        this.resources.mesh.findObjectByHash(init.hash as Hash, linkupServers, discoveryEndpoint);

                    return this.processDiscoveryReply(discovery);
                }
            });
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

            if (resources.config.peersForDiscovery === undefined) {
                throw new Error('Trying to open space for missing object ' + init.hash + ', but config.peersForDiscovery is undefined.');
            }

            const linkupServers = resources.config.linkupServers;
            const discoveryEndpoint = resources.config.peersForDiscovery[0].endpoint;


            const discovery =
                this.resources.mesh.findObjectByHashSuffix(suffix, linkupServers, discoveryEndpoint);

            this.entryPoint = this.processDiscoveryReply(discovery);
        } else {
            throw new Error('Created new space, but no initialization was provided (entry object nor hash no word code).');
        }
    }

    private processDiscoveryReply(discoveryStream: AsyncStream<ObjectDiscoveryReply>): Promise<HashedObject & SpaceEntryPoint> {
        return new Promise((resolve: (value: (HashedObject & SpaceEntryPoint)) => void, reject: (reason: 'timeout'|'end') => void) => {

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

        if (this.resources.config.peersForDiscovery === undefined) {
            throw new Error('Trying to start space broadcast but config.peersForDiscovery is undefined.');
        }

        const linkupServers = this.resources.config.linkupServers;
        const discoveryEndpoint = this.resources.config.peersForDiscovery[0].endpoint;

        this.entryPoint.then((ep: HashedObject & SpaceEntryPoint) => {
            this.resources.mesh.startObjectBroadcast(ep, linkupServers, [discoveryEndpoint]);
        });
    }

    stopBroadcast() {
        this.entryPoint.then((ep: HashedObject & SpaceEntryPoint) => {
            this.resources.mesh.stopObjectBroadcast(ep.hash());
        })
    }

    getResources() {
        return this.resources;
    }

}

export { Space, SpaceInit };