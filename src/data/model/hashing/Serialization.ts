class Serialization {

    static default(literal: any) {
        var plain = '';

        // this works both for object literals and arrays, arrays behave
        // like literals with "0", "1", "2"... as keys.

        if (typeof literal === 'object') {

          plain = plain + (Array.isArray(literal)? '[' : '{');

          var keys = Object.keys(literal);
          keys.sort();
    
          keys.forEach(key => {
            plain = plain +
                    Serialization.escapeString(key) + ':' + Serialization.default((literal as any)[key]) + ',';
          });

          plain = plain + (Array.isArray(literal)? ']' : '}');
        } else if (typeof literal === 'string') {
          plain = Serialization.escapeString(literal.toString());
        } else if (typeof literal === 'boolean' || typeof literal === 'number') {
          plain = literal.toString();
          // important notice: because of how the javascript number type works, we are sure that
          //                   integer numbers always get serialized without a fractional part
          //                   (e.g. '1.0' cannot happen)
        } else {
          throw new Error('Cannot serialize ' + literal + ', its type ' + (typeof literal) + ' is illegal for a literal.');
        }
    
        return plain;
    }

    private static escapeString(text: string) {
        return "'" + text.replace("'", "''") + "'";
    }

}

export { Serialization };