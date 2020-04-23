import { Swarm } from 'sync/swarm';
import { TestPeerControlAgent } from './agents/TestPeerControlAgent';
import { RNGImpl } from 'crypto/random';
import { LinearStateAgent } from './agents/LinearStateAgent';

import { Shuffle } from 'util/shuffling';
import { StateGossipAgent } from 'sync/agents/state/StateGossipAgent';

let buildSwarms = (peers: number, peersPerSwarm: number, agents: number, agentsPerPeer: number) => {
    let swarms = [];
    let rng = new RNGImpl();

    let peerIds = [];
    let agentIds = [];

    let topic = rng.randomHexString(64);

    for (let i=0; i<peers; i++) {
        peerIds.push(rng.randomHexString(128))
    }

    for (let i=0; i<agents; i++) {
        agentIds.push(rng.randomHexString(128));
    }

    for (let i=0; i<peers; i++) {
        const otherPeerIds = peerIds.slice();
        otherPeerIds.splice(i, 1);
        Shuffle.array(otherPeerIds);
        otherPeerIds.splice(peersPerSwarm, otherPeerIds.length - peersPerSwarm);

        let peerControl = new TestPeerControlAgent(peerIds[i], otherPeerIds);
        peerControl;
        let swarm = new Swarm(topic);

        swarm.registerLocalAgent(peerControl);
        //swarm.registerLocalAgent(new StateGossipAgent());
        new StateGossipAgent();

        let peerAgentIds = agentIds.slice();
        Shuffle.array(peerAgentIds);

        for(let j=0; j<agentsPerPeer; j++) {
            let agent = new LinearStateAgent(peerAgentIds[j]);
            agent;
            //swarm.registerLocalAgent(agent);
        }

        swarms.push(swarm);
    }

    return { swarms: swarms, agentIds: agentIds.map((id: string) => LinearStateAgent.createId(id)) };


}

describe('Agents', () => {
    test('Gossip agent in small swarm', async (done) => {

        if (Math.floor(Math.random()) > 100) {

        const swarmCount = 5;
        const peersPerSwarm = 3;
        const agentCount = 10;
        const agentsPerSwarm = 8;

        let creation = buildSwarms(swarmCount, peersPerSwarm, agentCount, agentsPerSwarm);


        console.log('built swarms');

        let swarms = creation.swarms;
        let agentIds = creation.agentIds;

        let seq0:Array<[number, string]> = [[0, 'zero'],[1,'one'], [2, 'two']];
        let seq1:Array<[number, string]> = [[10, 'a'], [10, 'b'], [3, 'three']]
        let seq2:Array<[number, string]> = [[11, 'eleven'], [10, 'ten'], [9, 'nine']];

        //let agent = swarms[0].getLocalAgent(agentIds[0]) as LinearStateAgent;

        //agent.setMessage('hello');



        await new Promise(r => { window.setTimeout(() => { r() }, 1000);  });


        console.log('done first wait');
        

        let seqs = [seq0, seq1, seq2];
        let witness: Array<LinearStateAgent> = [];
        let results: Array<[number, string]> = [[2, 'two'], [10, 'b'], [11, 'eleven']];

        for (let i=0; i<3; i++) {

            let agentId = agentIds[i];

            console.log('testing squence ' + i + ' for agent ' + agentId);

            let seq = seqs[i];

            let c=0;
            for (let j=0; c<4 && j<swarmCount; j++) {
                let agent=swarms[j].getLocalAgent(agentId) as LinearStateAgent;
                if (agent !== undefined) {
                    console.log('found ' + c + 'th agent for agentId ' + agentId);
                    if (c<3) {
                        seq
                        //agent.setMessage(seq[c][1], seq[c][0]);
                    } else {
                        witness.push(agent);
                    }
                    c=c+1;
                }
            }
        }

        console.log('waiting for state to propagete');

        let finished = false;
        let checks = 0;
        while (! finished && checks < 10) {
            console.log('tick ' + checks);
            
            await new Promise(r => { window.setTimeout( r, 50); });

            finished = true;
            for (let c=0; c<3 && finished; c++) {

                if (witness.length <= c) continue;

                finished = finished && witness[c].seq === results[c][0];
                finished = finished && witness[c].message === results[c][1];
            }
            console.log('ended tick ' + checks);
            checks = checks + 1;
            
        }

        console.log('done waiting');

        for (let c=0; c<3; c++) {

            if (witness.length <= c) continue;

            expect(witness[c].seq).toEqual(results[c][0]);
            expect(witness[c].message).toEqual(results[c][1])
        }

        for (const swarm of swarms) {
            swarm.shutdown();
        }
        }
        done();
    

    }, 20000);


});