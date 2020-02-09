

class Swarm {

    secret : string;
    members: Set<string>;

    purpose: any;
    state: any;

    constructor() {
        this.members = new Set();
        this.secret  = 'XYZ';
    }

    broadcast(message: any) {
        this.members.forEach((member: string) => {
            console.log(message + member);
        });
    }
}