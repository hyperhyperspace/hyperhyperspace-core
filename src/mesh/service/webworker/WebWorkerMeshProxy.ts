import { WebRTCConnectionsHost, WebRTCConnectionEvent } from 'net/transport';
import { LinkupManagerHost, LinkupManagerCommand } from 'net/linkup';

import { MeshCommand, MeshHost } from '../remoting/MeshHost';
import { MeshProxy } from '../remoting/MeshProxy';
import { Mesh } from '../Mesh';
import { Logger } from 'util/logging';


//import WebWorker from 'worker-loader!./mesh.worker';

class WebWorkerMeshProxy {

    static meshLogger = new Logger(WebWorkerMeshProxy.name);
    static linkupLogger = new Logger(WebWorkerMeshProxy.name);
    static webRTCLogger = new Logger(WebWorkerMeshProxy.name);

    meshCommandFwdFn: (cmd: MeshCommand) => void;
    linkupCommandFwdFn: (cmd: LinkupManagerCommand) => void;
    webRTCConnEventIngestFn: (ev: WebRTCConnectionEvent) => void;

    proxy: MeshProxy;
    worker: Worker;

    hostReady: boolean;
    ready: Promise<void>;
    readyCallback?: (value:void | PromiseLike<void>) => void;
    timeoutCallback?: (reason?: any) => void;

    constructor(worker: Worker) {

        this.hostReady = false;
        this.ready = new Promise<void>((resolve: (value: void | PromiseLike<void>) => void, reject: (reason?: any) => void) => {
            this.readyCallback = resolve;
            this.timeoutCallback = reject;

            if (this.hostReady) {
                resolve();
            }
        });

        this.meshCommandFwdFn = (cmd: MeshCommand) => {

            WebWorkerMeshProxy.meshLogger.trace('Sending mesh command to worker: ' + cmd?.type, cmd);

            try {
                this.worker.postMessage(cmd);
            } catch (e) {
                WebWorkerMeshProxy.meshLogger.warning('Could not send mesh command to worker:', cmd);
                WebWorkerMeshProxy.meshLogger.warning(cmd);
                WebWorkerMeshProxy.meshLogger.warning('Error was: ', e);
                throw e;
            }
            
        };

        this.linkupCommandFwdFn = (cmd: LinkupManagerCommand) => { 
            WebWorkerMeshProxy.linkupLogger.trace('Sending linkup command to worker: ' + cmd?.type, cmd);
            try {
                this.worker.postMessage(cmd);
            } catch (e) {
                WebWorkerMeshProxy.linkupLogger.warning('Could not send linkup command to worker:', cmd);
                WebWorkerMeshProxy.linkupLogger.warning(cmd);
                WebWorkerMeshProxy.linkupLogger.warning('Error was: ', e);
                throw e;
            } 
        };

        this.webRTCConnEventIngestFn = (ev: WebRTCConnectionEvent) => { 
            WebWorkerMeshProxy.webRTCLogger.trace('Sending webrtc event to worker: ' + ev?.type, ev);
            try {
                this.worker.postMessage(ev);
            } catch (e) {
                WebWorkerMeshProxy.webRTCLogger.warning('Could not send webrtc event to worker:', ev);
                WebWorkerMeshProxy.webRTCLogger.warning('Error was: ', e);
                throw e;
            } 
        };

        this.worker = worker;

        this.worker.onerror = (ev: ErrorEvent) => {
            console.log('ERROR RECEIVING PROXYIED MESSAGE FROM WEB WORKER:');
            console.log(ev);
        };

        this.worker.onmessage = (ev: MessageEvent) => {

            let data = ev.data;

            WebWorkerMeshProxy.meshLogger.debug('Receiving from worker: ' + data?.type, ev);

            if (ev.data.type==='mesh-worker-ready') {
                if (!this.hostReady) {
                    this.hostReady = true;
                    if (this.readyCallback !== undefined) {
                        this.readyCallback();
                    }
                }   
            }

            if (LinkupManagerHost.isEvent(data)) {
                WebWorkerMeshProxy.linkupLogger.debug('Ingesting linkup event:', data);
                this.proxy.linkup?.linkupManagerEventIngestFn(data);
            }

            if (WebRTCConnectionsHost.isCommand(data)) {
                WebWorkerMeshProxy.webRTCLogger.debug('Executing webrtc command:', data);

                if (this.proxy.webRTCConnsHost === undefined) {
                    WebWorkerMeshProxy.webRTCLogger.warning('webRTCConnsHost is undefined, message will be lost (!)');
                }

                try {
                    this.proxy.webRTCConnsHost?.execute(data);
                } catch (e) {
                    WebWorkerMeshProxy.webRTCLogger.error('Error trying to execute webrtc command:', e);
                }
                
            }

            if (MeshHost.isStreamedReply(data)) {
                WebWorkerMeshProxy.meshLogger.debug('Ingesting streamed reply:', data);
                this.proxy.commandStreamedReplyIngestFn(data);
            }

            if (MeshHost.isPeerSourceRequest(data)) {
                WebWorkerMeshProxy.meshLogger.debug('Ingesting peer source request:', data);
                this.proxy.peerSourceRequestIngestFn(data);
            }

        }

        this.proxy = new MeshProxy(this.meshCommandFwdFn, this.linkupCommandFwdFn, this.webRTCConnEventIngestFn);

        this.worker.postMessage({type: 'mesh-worker-ready-query'})
    }

    getMesh(): Mesh {
        return this.proxy as unknown as Mesh;
    }

}

export { WebWorkerMeshProxy };