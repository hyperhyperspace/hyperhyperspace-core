import { WebRTCConnectionsHost, WebRTCConnectionEvent } from 'net/transport';
import { LinkupManagerHost, LinkupManagerCommand } from 'net/linkup';

import { MeshCommand, MeshHost } from '../remoting/MeshHost';
import { MeshProxy } from '../remoting/MeshProxy';
import { Mesh } from '../Mesh';
import { Logger } from 'util/logging';


//import WebWorker from 'worker-loader!./mesh.worker';

class WebWorkerMeshProxy {

    static logger = new Logger();

    meshCommandFwdFn: (cmd: MeshCommand) => void;
    linkupCommandFwdFn: (cmd: LinkupManagerCommand) => void;
    webRTCConnEventIngestFn: (ev: WebRTCConnectionEvent) => void;

    proxy: MeshProxy;
    worker: Worker;

    constructor(worker: Worker) {

        this.meshCommandFwdFn = (cmd: MeshCommand) => {

            WebWorkerMeshProxy.logger.trace('Sending mesh command to worker: ' + cmd?.type);
            WebWorkerMeshProxy.logger.trace(cmd);

            try {
                this.worker.postMessage(cmd);
            } catch (e) {
                WebWorkerMeshProxy.logger.warning('Could not send mesh command to worker:');
                WebWorkerMeshProxy.logger.warning(cmd);
                WebWorkerMeshProxy.logger.warning('Error was: ' + e);
                throw e;
            }
            
        };

        this.linkupCommandFwdFn = (cmd: LinkupManagerCommand) => { 
            WebWorkerMeshProxy.logger.trace('Sending linkup command to worker: ' + cmd?.type);
            WebWorkerMeshProxy.logger.trace(cmd);
            try {
                this.worker.postMessage(cmd);
            } catch (e) {
                WebWorkerMeshProxy.logger.warning('Could not send linkup command to worker:');
                WebWorkerMeshProxy.logger.warning(cmd);
                WebWorkerMeshProxy.logger.warning('Error was: ' + e);
                throw e;
            } 
        };

        this.webRTCConnEventIngestFn = (ev: WebRTCConnectionEvent) => { 
            WebWorkerMeshProxy.logger.trace('Sending webrtc event to worker: ' + ev?.type);
            WebWorkerMeshProxy.logger.trace(ev);
            try {
                this.worker.postMessage(ev);
            } catch (e) {
                WebWorkerMeshProxy.logger.warning('Could not send webrtc event to worker:');
                WebWorkerMeshProxy.logger.warning(ev);
                WebWorkerMeshProxy.logger.warning('Error was: ' + e);
                throw e;
            } 
        };

        this.worker = worker;
        this.worker.onmessage = (ev: MessageEvent) => {

            let data = ev.data;

            WebWorkerMeshProxy.logger.debug('Receiving from worker: ' + data?.type);
            WebWorkerMeshProxy.logger.debug(ev);

            if (LinkupManagerHost.isEvent(data)) {
                WebWorkerMeshProxy.logger.debug('Ingesting linkup event');
                this.proxy.linkup?.linkupManagerEventIngestFn(data);
            }

            if (WebRTCConnectionsHost.isCommand(data)) {
                WebWorkerMeshProxy.logger.debug('Executing webrtc command');
                this.proxy.webRTCConnsHost?.execute(data);
            }

            if (MeshHost.isStreamedReply(data)) {
                WebWorkerMeshProxy.logger.debug('Ingesting streamed reply');
                this.proxy.commandStreamedReplyIngestFn(data);
            }

            if (MeshHost.isPeerSourceRequest(data)) {
                WebWorkerMeshProxy.logger.debug('Ingesting peer source request');
                this.proxy.peerSourceRequestIngestFn(data);
            }

        }

        this.proxy = new MeshProxy(this.meshCommandFwdFn, this.linkupCommandFwdFn, this.webRTCConnEventIngestFn);

    }

    getMesh(): Mesh {
        return this.proxy as any as Mesh;
    }

}

export { WebWorkerMeshProxy };