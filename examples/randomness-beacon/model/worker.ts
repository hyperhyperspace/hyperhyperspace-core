import { parentPort } from 'worker_threads';
import { VDF } from './VDF';

class VDFWorker {
    static start() {
    
            parentPort?.on('message', async (q: {challenge: string, steps: number}) => {

    
                let result = await VDF.compute(q.challenge, q.steps);

                if (parentPort !== undefined && parentPort !== null) {
                    parentPort.postMessage(
                        { 
                            challenge: q.challenge,
                            steps: q.steps,
                            result: result
                        }
                    );

                }

                
            });
    }
}

VDFWorker.start();
