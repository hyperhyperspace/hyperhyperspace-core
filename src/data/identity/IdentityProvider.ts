import { Identity } from './Identity';
import { Literal, LiteralContext } from '../model/HashedObject';

interface IdentityProvider {
    signText(text:string, id: Identity): Promise<string>;
    signLiteral(literal: Literal): Promise<void>;
    signLiteralContext(literalContext: LiteralContext): Promise<void>;
}

export { IdentityProvider }