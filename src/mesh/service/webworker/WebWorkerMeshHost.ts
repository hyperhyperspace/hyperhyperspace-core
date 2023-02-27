import { WebRTCConnectionCommand, WebRTCConnectionsHost } from 'net/transport';
import { LinkupManagerHost, LinkupManagerEvent } from 'net/linkup';

import { MeshHost, CommandStreamedReply, PeerSourceRequest } from '../remoting/MeshHost';
import { Mesh } from '../Mesh';
import { Logger } from 'util/logging';



/* eslint-disable-next-line no-restricted-globals */
//const worker: DedicatedWorkerGlobalScope | undefined = self || undefined as any;

class WebWorkerMeshHost {

    static logger = new Logger();

    linkupEventIngestFn: (ev: LinkupManagerEvent) => void;
    webRTCCommandFn: (cmd: WebRTCConnectionCommand) => void;

    commandStreamedReplyIngestFn: (reply: CommandStreamedReply) => void;
    peerSourceRequestIngestFn: (req: PeerSourceRequest) => void;

    mesh: Mesh;
    host: MeshHost;
    worker: DedicatedWorkerGlobalScope;

    constructor() {

        this.worker = self as any;

        this.linkupEventIngestFn = (ev: LinkupManagerEvent) => {
            WebWorkerMeshHost.logger.trace('Sending linkup event to main thread: ' + ev?.type);
            WebWorkerMeshHost.logger.trace(ev);
            try {
                this.worker.postMessage(ev);
            } catch (e) {
                WebWorkerMeshHost.logger.warning('Could not send linkup event to main thread:');
                WebWorkerMeshHost.logger.warning(ev);
                WebWorkerMeshHost.logger.warning('Error was: ' + e);
            }
            
        }
        
        this.webRTCCommandFn = (cmd: WebRTCConnectionCommand) => {
            WebWorkerMeshHost.logger.trace('Sending webrtc command to main thread: ' + cmd?.type);
            WebWorkerMeshHost.logger.trace(cmd);
            try {
                this.worker.postMessage(cmd);
            } catch (e) {
                WebWorkerMeshHost.logger.warning('Could not send webrtc command to main thread:');
                WebWorkerMeshHost.logger.warning(cmd);
                WebWorkerMeshHost.logger.warning('Error was: ' + e);
            }
            
        }
        
        const proxyConfig = {
            linkupEventIngestFn: this.linkupEventIngestFn, 
            webRTCCommandFn: this.webRTCCommandFn
        };
        
        this.mesh = new Mesh(proxyConfig);
        
        this.commandStreamedReplyIngestFn = (reply: CommandStreamedReply) => {
            WebWorkerMeshHost.logger.trace('Sending command streamed reply to main thread: ' + reply?.type);
            WebWorkerMeshHost.logger.trace(reply);
            try {
                this.worker.postMessage(reply);
            } catch (e) {
                WebWorkerMeshHost.logger.warning('Could not send command streamed reply to main thread:');
                WebWorkerMeshHost.logger.warning(reply);
                WebWorkerMeshHost.logger.warning('Error was: ' + e);
            }
            
        };

        this.peerSourceRequestIngestFn = (req: PeerSourceRequest) => {
            WebWorkerMeshHost.logger.trace('Sending peer source request to main thread: ' + req?.type);
            WebWorkerMeshHost.logger.trace(req);
            try {
                this.worker.postMessage(req);
            } catch (e) {
                WebWorkerMeshHost.logger.warning('Could not send peer source request to main thread:');
                WebWorkerMeshHost.logger.warning(req);
                WebWorkerMeshHost.logger.warning('Error was: ' + e);
            }
            
        }
        
        this.host = new MeshHost(this.mesh, this.commandStreamedReplyIngestFn, this.peerSourceRequestIngestFn);
        
        this.worker.onerror = (ev: ErrorEvent) => {
            console.log('ERROR RECEIVING PROXYIED MESSAGE FROM MAIN THREAD:');
            console.log(ev);
        };

        this.worker.onmessage = (msg: { data : any }) => {
        
            const data = msg?.data;
        
            WebWorkerMeshHost.logger.debug('Received from main: ' + data?.type);
            WebWorkerMeshHost.logger.debug(msg);

            if (data.type === 'mesh-worker-ready-query') {
                this.worker.postMessage({type: 'mesh-worker-ready'});
            }

            if (MeshHost.isCommand(data)) {
                WebWorkerMeshHost.logger.debug('Executing mesh command');
                this.host.execute(data);
            }
        
            if (LinkupManagerHost.isCommand(data)) {
                WebWorkerMeshHost.logger.debug('Executing linkup command');
                this.mesh.network.linkupManagerHost?.execute(data);
            }
        
            if (WebRTCConnectionsHost.isEvent(data)) {
                WebWorkerMeshHost.logger.debug('Ingesting webrtc event');
                if (this.mesh.network.webRTCConnEventIngestFn !== undefined) {
                    this.mesh.network.webRTCConnEventIngestFn(data);
                    WebWorkerMeshHost.logger.debug('Ingested ok');
                }
            }
        
        };

        this.worker.postMessage({type: 'mesh-worker-ready'});
    }
}

export { WebWorkerMeshHost };
