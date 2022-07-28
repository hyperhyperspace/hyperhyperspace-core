import { WordCode } from 'crypto/wordcoding';
import { Hash, HashedLiteral, HashedObject, Hashing } from 'data/model';
import { ObjectBroadcastAgent, ObjectDiscoveryReply } from 'mesh/agents/discovery';
import { AsyncStream } from 'util/streams';
import { SpaceEntryPoint } from './SpaceEntryPoint';
import { Resources } from './Resources';
import { SpaceInfo } from './SpaceInfo';
import { LinkupAddress } from 'net/linkup';

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

            this.entryPoint = this.saveSpaceInfo(init.entryPoint).then(() => {
                 return Promise.resolve(init.entryPoint as (HashedObject & SpaceEntryPoint));
            })
            
        } else if (init.hash !== undefined) {

            this.entryPoint = this.resources.store.load(init.hash, false, false).then((obj: HashedObject | undefined) => {
                if (obj !== undefined) {
                    return obj as HashedObject & SpaceEntryPoint;
                } else {
                    /*if (resources.config.peersForDiscovery === undefined) {
                        throw new Error('Trying to open space for missing object ' + init.hash + ', but config.peersForDiscovery is undefined.');
                    }

                    const linkupServers = resources.config.linkupServers;
                    const discoveryEndpoint = resources.config.peersForDiscovery[0].endpoint;
            
                    const discovery = 
                        this.resources.mesh.findObjectByHash(init.hash as Hash, linkupServers, discoveryEndpoint);

                    return this.processDiscoveryReply(discovery);*/
                    return this.lookupOrDiscover(Hashing.toHex(init.hash as Hash));
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
                } catch (e: any) {
                    lastError = e;
                }
            }

            if (suffix === undefined) {
                throw new Error('Could not decode wordCode ' + init.wordCode.join(' ') + ', last error: ' + lastError);
            }

            this.entryPoint = this.lookupOrDiscover(suffix);
        } else {
            throw new Error('Created new space, but no initialization was provided (entry object nor hash nor word code).');
        }

    }

    private async lookupOrDiscover(suffix: string): Promise<HashedObject & SpaceEntryPoint> {
        
        const results = await this.resources.store.loadByReference('hashSuffixes', new HashedLiteral(suffix).hash());

        for (const obj of results.objects) {
            if (obj instanceof SpaceInfo && obj.getClassName() === SpaceInfo.className) {
                if (ObjectBroadcastAgent.hexSuffixFromHash(obj.getLastHash(), suffix.length * 4)) {
                    return Promise.resolve(obj.entryPoint as HashedObject & SpaceEntryPoint);
                }
            }
        }

        if (this.resources.config.peersForDiscovery === undefined) {
            throw new Error('Trying to open space for missing object with suffix ' + suffix + ', but config.peersForDiscovery is undefined.');
        }

        const linkupServers = this.resources.config.linkupServers;
        const discoveryAddress = LinkupAddress.fromURL(this.resources.config.peersForDiscovery[0].endpoint, this.resources.config.peersForDiscovery[0].identity);


        const discovery =
            this.resources.mesh.findObjectByHashSuffix(suffix, linkupServers, discoveryAddress);

        return this.processDiscoveryReply(discovery);
    }

    private processDiscoveryReply(discoveryStream: AsyncStream<ObjectDiscoveryReply>): Promise<HashedObject & SpaceEntryPoint> {
        this.entryPoint.then((entryPoint: (HashedObject & SpaceEntryPoint)) => { this.saveSpaceInfo(entryPoint) });
        return new Promise((resolve: (value: (HashedObject & SpaceEntryPoint)) => void, reject: (reason: 'timeout'|'end') => void) => {

            discoveryStream.next(30000).then((reply: ObjectDiscoveryReply) => {
                resolve(reply.object as (HashedObject & SpaceEntryPoint));
            }).catch((reason: any) => {
                reject(reason);
            });
        
        });
    }

    private async saveSpaceInfo(entryPoint: (HashedObject & SpaceEntryPoint)) {

        const spaceInfo = new SpaceInfo(entryPoint);

        await this.resources.store.save(spaceInfo);
    }

    async getEntryPoint(): Promise<HashedObject & SpaceEntryPoint> {
        return this.entryPoint;
    }

    async getHash(): Promise<Hash> {
        let entry = await this.entryPoint;
        return entry.hash();
    }

    async getWordCoding(words=3, lang='en'): Promise<string[]> {
        return Space.getWordCodingFor(await this.entryPoint, words, lang);
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

    static getWordCodingFor(entryPoint: HashedObject, words=3, lang='en') {

        const hash = entryPoint.hash();

        return Space.getWordCodingForHash(hash, words, lang);
    }

    static getWordCodingForHash(hash: Hash, words=3, lang='en') {

        let coder = WordCode.lang.get(lang);

        if (coder === undefined) {
            throw new Error('Could not find word coder for language ' + lang + '.');
        }

        const nibbles = coder.bitsPerWord * words / 4;

        const suffix = Hashing.toHex(hash).slice(-nibbles);

        return coder.encode(suffix)
    }

}

export { Space, SpaceInit };