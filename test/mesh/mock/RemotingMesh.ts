import { Mesh, MeshClient, MeshCommand, MeshServer } from 'mesh/service';


class RemotingMesh {

    mesh: Mesh;
    server: MeshServer;
    client: MeshClient;

    constructor() {
        this.mesh = new Mesh();
        this.client = new MeshClient((cmd: MeshCommand) => { this.server.execute(cmd)});
        this.server = new MeshServer(this.mesh, this.client.commandStreamedReplyIngestFn);
    }
    
}

export { RemotingMesh };