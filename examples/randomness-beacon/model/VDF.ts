const createVdf = require('@subspace/vdf').default;
(global as any).document = { }; // yikes!

class VDF {
    static async compute(challenge: string, steps: number): Promise<string> {

        console.log('computing...')

        const vdfInstance = await createVdf();
        const result = vdfInstance.generate(steps, Buffer.from(challenge, 'hex'), 2048, true);

        console.log('done!')

        const t = Date.now();

        console.log('verification: ' + vdfInstance.verify(steps, Buffer.from(challenge, 'hex'), result, 2048, true));

        const elapsed = Date.now() - t;

        console.log('verification took ' + elapsed + ' millis');

        return Buffer.from(result).toString('hex');
    }
}

export { VDF };