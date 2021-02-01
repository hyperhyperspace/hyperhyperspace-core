import { Mesh, MeshProxy, MeshCommand, MeshProxyHost } from 'mesh/service';
import { WebRTCConnectionCommand, WebRTCConnectionEvent, WebRTCConnectionProxyHost } from 'net/transport';
import { LinkupManagerCommand, LinkupManagerEvent } from '../../../src';


class RemotingMesh {

    mesh: Mesh;
    server: MeshProxyHost;
    client: MeshProxy;

    connections: Map<string, WebRTCConnectionProxyHost>;

    linkupCommandFwdFn?: (cmd: LinkupManagerCommand) => void;
    linkupEventIngestFn?: (ev: LinkupManagerEvent) => void;
    
    webRTCCommandFn?: (cmd: WebRTCConnectionCommand) => void;
    webRTCConnEventIngestFn?: (ev: WebRTCConnectionEvent) => void;

    
    

    constructor() {

        this.linkupCommandFwdFn = (cmd: LinkupManagerCommand) => {
            setTimeout(() => { this.server.mesh.network.linkupManagerHost?.execute(cmd); }, 0);
        }

        this.linkupEventIngestFn = (ev: LinkupManagerEvent) => {
            this.client.linkup?.linkupManagerEventIngestFn(ev);
        }

        this.webRTCCommandFn = (cmd: WebRTCConnectionCommand) => {
            setTimeout(() => { this.client.webRTCConnProxyHost?.execute(cmd); }, 0);
        }

        this.webRTCConnEventIngestFn = (ev: WebRTCConnectionEvent) => {
            if (this.server.mesh.network.webRTCConnEventIngestFn !== undefined) {
                this.server.mesh.network.webRTCConnEventIngestFn(ev);
            }
        }

        const proxyConfig = {
            linkupEventIngestFn: this.linkupEventIngestFn, 
            webRTCCommandFn: this.webRTCCommandFn
        };

        this.mesh = new Mesh(proxyConfig);
        this.client = new MeshProxy(
            (cmd: MeshCommand) => { setTimeout(() => { this.server.execute(cmd) }, 0);},
            this.linkupCommandFwdFn,
            this.webRTCConnEventIngestFn
        );
        this.server = new MeshProxyHost(this.mesh, this.client.commandStreamedReplyIngestFn);

        this.connections = new Map();
    }
    
}

export { RemotingMesh };