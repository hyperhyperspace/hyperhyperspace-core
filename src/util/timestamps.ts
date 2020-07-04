import { RNGImpl } from 'crypto/random.js';

class Timestamps {

  static currentTimestamp(): string {
    return 'T' + Date.now().toString(16).padStart(11, '0');
  }

  static uniqueTimestamp(): string {
    const random = new RNGImpl().randomHexString(64);
    return Timestamps.currentTimestamp() + random;
  }

  static epochTimestamp(): string {
    return 'T' + ''.padStart(11 + 16, '0');
  }

  static parseUniqueTimestamp(unique: string) {
    return parseInt(unique.substring(1,12), 16);
  }


  static compare(a: string, b:string) {
    a = a.toLowerCase();
    b = b.toLowerCase();
    // returns sign(a - b)
    return a.localeCompare(b);
  }

  static before(a: string, b: string) {
    return Timestamps.compare(a, b) < 0;
  }

  static after(a: string, b: string) {
    return Timestamps.compare(a, b) > 0;
  }

}

export { Timestamps };