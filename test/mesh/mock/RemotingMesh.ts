import { Mesh, MeshProxy, MeshCommand, MeshHost } from 'mesh/service';
import { WebRTCConnectionCommand, WebRTCConnectionEvent } from 'net/transport';
import { LinkupManagerCommand, LinkupManagerEvent } from 'net/linkup';


class RemotingMesh {

    mesh: Mesh;
    server: MeshHost;

    client: MeshProxy;

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
            setTimeout(() => { this.client.webRTCConnsHost?.execute(cmd); }, 0);
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
        this.server = new MeshHost(this.mesh, this.client.commandStreamedReplyIngestFn);
    }
    
}

export { RemotingMesh };