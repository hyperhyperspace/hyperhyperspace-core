import { Identity } from './Identity';
import { Literal } from '../model/Literals';
import { LiteralContext, Context } from '../model/Context';

interface IdentityProvider {
    signText(text:string, id: Identity): Promise<string>;
    signLiteral(literal: Literal): Promise<void>;
    signLiteralContext(literalContext: LiteralContext): Promise<void>;
    signContext(context: Context): Promise<void>;
}

export { IdentityProvider }