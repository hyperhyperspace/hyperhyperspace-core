
class Strings {
    static base64toHex(base64: string) {

        var raw = atob(base64);
      
        var hex = '';
      
        for (let i = 0; i < raw.length; i++ ) {
      
          var _hex = raw.charCodeAt(i).toString(16)
      
          hex += (_hex.length==2?_hex:'0'+_hex);
      
        }
        return hex.toUpperCase();
      
      }
}

export { Strings };