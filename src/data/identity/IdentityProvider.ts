import { Identity } from './Identity';
import { Literal } from '../model/literals/LiteralUtils';
import { LiteralContext, Context } from '../model/literals/Context';

interface IdentityProvider {
    signText(text:string, id: Identity): Promise<string>;
    signLiteral(literal: Literal): Promise<void>;
    signLiteralContext(literalContext: LiteralContext): Promise<void>;
    signContext(context: Context): Promise<void>;
}

export { IdentityProvider }