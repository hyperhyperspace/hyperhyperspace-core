import { ChaCha20Impl } from 'crypto/ciphers';
import { Identity } from 'data/identity';
import { HashedObject, Hashing, LiteralContext } from 'data/model';
import { Agent, AgentEvent, AgentPod } from 'mesh/service';
import { LinkupAddress } from 'net/linkup';
import { Logger, LogLevel } from 'util/logging';
import { MultiMap } from 'util/multimap';
import { Endpoint, LinkupMessage, NetworkAgent, NetworkEventType } from '../network';

type ObjectSpawnRequestEnvelope = {
    payload: string,
    encKey: string,
    nonce: string
};

type ObjectSpawnRequest = {
    objectLiteralContext: LiteralContext,
    timestamp: number,
    sender: LiteralContext,
    signature: string,
    mumble: string // variable length muble jumble
};

type LinkupServer  = string;
type SpawnCallback = (object: HashedObject, sender: Identity, senderEndpoint: Endpoint) => void;

class ObjectSpawnAgent implements Agent {
    
    static log = new Logger(ObjectSpawnAgent.name, LogLevel.INFO);

    static defaultSpawnId = 'spawn';

    static agentIdFor(owner: Identity, spawnId: string) {
        return 'object-spawn-for-' + owner.getLastHash() + '-with-id:' + spawnId;
    }

    static linkupIdFor(owner: Identity, spawnId: string) {
        return LinkupAddress.verifiedIdPrefix + Hashing.toHex(owner.getLastHash()) + '/' + spawnId;
    }

    static requestForSignature(obj: HashedObject, timestamp: number) {
        return obj.getLastHash() + '_' + timestamp;
    }

    pod?: AgentPod;

    owner: Identity;
    spawnId: string;

    callbacks: MultiMap<LinkupServer, SpawnCallback>;

    constructor(owner: Identity, spawnId=ObjectSpawnAgent.defaultSpawnId) {

        this.owner   = owner;
        this.spawnId = spawnId;

        this.callbacks = new MultiMap();
    }

    getAgentId() {
        return ObjectSpawnAgent.agentIdFor(this.owner, this.spawnId);
    }

    ready(pod: AgentPod): void {

        this.pod = pod;

        for (const linkupServer of this.callbacks.keys()) {
            this.createListener(linkupServer);
        }

        ObjectSpawnAgent.log.debug('Started ObjectSpawnAgent for ' + this.owner.getLastHash() + ', spawnId is: ' + this.spawnId);

    }

    shutdown(): void {
        // TODO: stop listening on the linkup addresses
    }

    addSpawnCallback(linkupServers: string[], callback: SpawnCallback) {

        for (const linkupServer of linkupServers) {
            if (!this.callbacks.hasKey(linkupServer)) {
                if (this.pod !== undefined) {
                    this.createListener(linkupServer);
                }
            }
            this.callbacks.add(linkupServer, callback);
        }
    }

    receiveLocalEvent(ev: AgentEvent): void {
        if (ev.type === NetworkEventType.LinkupMessageReceived) {

            const msg = ev.content as LinkupMessage;

            if (msg.agentId === this.getAgentId()) {

                const env = msg.content as ObjectSpawnRequestEnvelope;

                this.owner.decrypt(env.encKey).then((key: string) => {
                    try {
                        const cleartext = new ChaCha20Impl().decryptHex(env.payload, key, env.nonce);
                        this.process(JSON.parse(cleartext), msg.source);
                    } catch (e: any) {
                        ObjectSpawnAgent.log.warning('Error attempting to decrypt object spawn request payload: ' + e);
                    }
                
                }).catch((e: any) => {
                    ObjectSpawnAgent.log.warning('Error attempting to decrypt object spawn request key: ' + e);
                });
            }
        }
    }

    private async process(req: ObjectSpawnRequest, senderEndpoint: Endpoint) {

        try {
            
            if ((typeof req.timestamp) !== 'number') {
                throw new Error('Timestamp is missing or invalid');
            }
            
            const obj = await HashedObject.fromLiteralContextWithValidation(req.objectLiteralContext);

            if (req.sender !== undefined) {
                const sender = await HashedObject.fromLiteralContextWithValidation(req.sender);

                if (!(sender instanceof Identity)) {
                    throw new Error('Object spawn request sender is not an Identity');
                }

                if ((typeof req.signature) !== 'string') {
                    throw new Error('Missing or invalid signature');
                }

                if (!(await sender.verifySignature(ObjectSpawnAgent.requestForSignature(obj, req.timestamp), req.signature as string))) {
                    throw new Error('Wrong signature');
                }

                const linkupServer = LinkupAddress.fromURL(senderEndpoint).serverURL;

                for (const callback of this.callbacks.get(linkupServer)) {
                    try {
                        callback(obj, sender, senderEndpoint);
                    } catch (e) {
                        ObjectSpawnAgent.log.warning('Error while calling spawn callback for object ' + obj.hash() + ' of class ' + obj.getClassName());
                    }
                }

            } else {
                if (req.signature !== undefined) {
                    throw new Error('Object spawn request is signed, but the sender identity is missing');
                }
            }

        } catch (reason: any) {
            ObjectSpawnAgent.log.warning('Error while calling spawn callback for object:' + reason);
        }
    }

    private createListener(linkupServer: string) {
        const networkAgent = this.getNetworkAgent();
        
        const linkupId = ObjectSpawnAgent.linkupIdFor(this.owner, this.spawnId);

        let address = new LinkupAddress(linkupServer, linkupId);

        networkAgent.listenForLinkupMessages(address.url(), this.owner);
        ObjectSpawnAgent.log.trace(() => 'Listening for spwan requests on linkup address ' + address.url());
    }

    // shorthand functions

    private getNetworkAgent() {
        return this.pod?.getAgent(NetworkAgent.AgentId) as NetworkAgent;
    }

}

export { ObjectSpawnAgent, ObjectSpawnRequest, ObjectSpawnRequestEnvelope, SpawnCallback };