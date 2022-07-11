import { ChaCha20Impl } from 'crypto/ciphers';
import { RNGImpl } from 'crypto/random';
import { Identity } from 'data/identity';
import { Hash, HashedObject } from 'data/model';
import { Agent, AgentPod } from 'mesh/service';
import { AgentEvent } from 'mesh/service/AgentPod';
import { LinkupAddress } from 'net/linkup';
import { Logger, LogLevel } from 'util/logging';
import { Endpoint, NetworkAgent } from '../network';

import { ObjectSpawnAgent, ObjectSpawnRequest, ObjectSpawnRequestEnvelope } from './ObjectSpawnAgent';

class ObjectInvokeAgent implements Agent {

    static log = new Logger(ObjectInvokeAgent.name, LogLevel.INFO);

    static agentIdFor(owner: Identity, spawnId: string): string {
        return 'object-invoke-for' + owner.getLastHash() + '-with-id:' + spawnId;
    }

    pod?: AgentPod;

    owner: Identity;
    spawnId: string;

    constructor(owner: Identity, spawnId=ObjectSpawnAgent.defaultSpawnId) {
        
        this.owner = owner;
        this.spawnId = spawnId;
    }

    sendRequest(object: HashedObject, receiver: Identity, receiverLinkupServers: string[], senderEndpoint: Endpoint) {

        const timestamp = Date.now();

        this.owner.sign(ObjectSpawnAgent.requestForSignature(object, timestamp)).then((signature: string) => {

            this.owner.sign(object.getLastHash()).then((h: Hash) => {
                const length = new RNGImpl().randomByte() + h.charCodeAt(0);

                const req: ObjectSpawnRequest = {
                    objectLiteralContext: object.toLiteralContext(),
                    timestamp: timestamp,
                    sender: this.owner.toLiteralContext(),
                    signature: signature,
                    mumble: 'X'.repeat(length)
                };
    
                const key   = new RNGImpl().randomHexString(256);
                const nonce = new RNGImpl().randomHexString(96);
                const payload = new ChaCha20Impl().encryptHex(JSON.stringify(req), key, nonce);

                receiver.encrypt(key).then((encKey: string) => {
                    const networkAgent = this.getNetworkAgent();
    
                    const msg: ObjectSpawnRequestEnvelope = {
                        payload: payload,
                        encKey: encKey,
                        nonce: nonce
                    }
    
                    for (const linkupServer of receiverLinkupServers) {
                        
                        networkAgent.sendLinkupMessage(
                            LinkupAddress.fromURL(senderEndpoint),
                            new LinkupAddress(linkupServer, ObjectSpawnAgent.linkupIdFor(receiver, this.spawnId)),
                            ObjectSpawnAgent.agentIdFor(receiver, this.spawnId),
                            msg
                        );
                    }
                });
            });

            
        });


    }

    getAgentId(): string {
        return ObjectInvokeAgent.agentIdFor(this.owner, this.spawnId);
    }

    ready(pod: AgentPod): void {
        this.pod = pod;
    }

    receiveLocalEvent(_ev: AgentEvent): void {
        
    }

    shutdown(): void {
        
    }

    private getNetworkAgent() {
        return this.pod?.getAgent(NetworkAgent.AgentId) as NetworkAgent;
    }

}

export { ObjectInvokeAgent };