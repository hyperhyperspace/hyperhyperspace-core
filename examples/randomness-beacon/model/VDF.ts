import { Logger, LogLevel } from "util/logging";

const createVdf = require('@subspace/vdf').default;
(global as any).document = { }; // yikes!

class VDF {

    static log = new Logger(VDF.name, LogLevel.TRACE)

    static async compute(challenge: string, steps: number): Promise<string> {

        VDF.log.debug('Computing VDF...');

        const vdfInstance = await createVdf();
        const result = vdfInstance.generate(steps, Buffer.from(challenge, 'hex'), 2048, false);

        VDF.log.debug('Done computing VDF.')

        const t = Date.now();

        VDF.log.debug('VDF sekf verification: ' + vdfInstance.verify(steps, Buffer.from(challenge, 'hex'), result, 2048, true));

        const elapsed = Date.now() - t;

        VDF.log.debug('verification took ' + elapsed + ' millis');

        return Buffer.from(result).toString('hex');
    }
}

export { VDF };