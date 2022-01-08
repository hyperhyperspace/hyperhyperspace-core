class Serialization {

    static default(literal: any) {
        var plain = '';

        // this works both for object literals and arrays, arrays behave
        // like literals with "0", "1", "2"... as keys.

        if (typeof literal === 'object') {

          plain = plain + '{';

          var keys = Object.keys(literal);
          keys.sort();
    
          keys.forEach(key => {
            plain = plain +
                    Serialization.escapeString(key) + ':' + Serialization.default((literal as any)[key]) + ',';
          });

          plain = plain + '}';
        } else {
          plain = Serialization.escapeString(literal.toString());
        }
    
        return plain;
    }

    private static escapeString(text: string) {
        return "'" + text.toString().replace("'", "''") + "'";
    }

}

export { Serialization };