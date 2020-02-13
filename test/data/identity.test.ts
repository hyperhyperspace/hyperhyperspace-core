import { Identity, RSAKeyPair, RSAPublicKey as _PK } from 'data/identity';
import { HashedObject } from 'data/model';


describe('Identity', () => {
    test( 'Basic identity', () => {


        let privateKey = 
        "-----BEGIN RSA PRIVATE KEY-----\n" +
        "MIIEogIBAAKCAQB52EypOvlrF6ou80w6qDshC7+8/8mEAzVJXk1NTZamn9WRu9QV\n" +
        "4P34/4pdZ6y2CplHmpUeUpjvXE/I1P8tr+NAR7zE/7XugQBJTWreN69he3jephMT\n" +
        "sBaK2WVvuR/El6JWricvrFqXb9LeeZZ//R87vlCxj1OjkRQJ01zahUqtutuhcvZk\n" +
        "WtT7L2bjlGlziGQ+TkZeUqqLEcf8n0/jivcZWjVspxcTRaa5FZ+4jPnNhQrx+lgX\n" +
        "jgp7nj1SCCx0arNGQUp1jlfblqEeEtYjJNoSFgXJuWhNEMa63Uk0WoHIRJ8L3ZaA\n" +
        "UDolHDF8oOFSXHk0fc9LR1cUCiTMB8hU3q1vAgMBAAECggEASoEyz0Bah1ufGrp2\n" +
        "4F9CWMCga+dUx75WdRiO2DgbaKPPqh9aXk6Hvhwz9U2R1HbCp4Aksrf7AFJIDxv/\n" +
        "NWaZ5RJ4oVVjYAXNsQT/1gXi3g7sJ+kRPTatchXg6uIeRM4b3Dj9iS8w7ezY2mUq\n" +
        "2/Rhhtym5wwnLptlz2RJIO3kbjo7R8KnK193qidC7MrFfV1zpiQs4HIZK/RenSwV\n" +
        "Q7OYfazk6v0r9gSUDNuzVU1tX4IWI8UJpeCGpCgK9GMVempoMy4eHM0Y1RRl2st1\n" +
        "m4RfS+Mac/OmtbhLIOO9OJekDunE0CWpbqvTMe24g91C95+A9myrZTZcTR4nJlus\n" +
        "xYukIQKBgQDQ/HHe/uN3AtUn8wWnakBArDmZeH7/Hr6+0yKPzZA8IXxu7slNbKdk\n" +
        "Mi9P8QXXZ4H923RuOJ4nzXN4WHhWS/s99++q5onJEsJOrV1slp3f7oiLYQVuTSOD\n" +
        "83NSjoadG0qNh9U7Fuk1ViXWapdoCcSGWYPbYN5JEzQp6fSodkq+pwKBgQCVQV/m\n" +
        "Gt+xNeczWeaUtHDTP4vsZ7SCsRb1K4Oo2NbKCUWKi7PcxPvy0Z4PYU/l2GbzprJk\n" +
        "TQelbRR0bg52xddGaBLvJkg/0ApIjngb1jv2PYzMgM+1ts0fdSDrmBZtrFBFtS4m\n" +
        "+bQS6kW4PQSjlJjdZDw2UK/M78OENoVtagd7+QKBgCdl4AW9IZ63Dv44B3HXSwOm\n" +
        "NDmliLOJ1UXeQd7ATxe27GFxbMvG1wvBlj/I3WQNZGk6LQn2bIJubf1bGFyUeGnn\n" +
        "Sux6B7G7cpwofLtS7bJgoqc8BC0WJ8Lha3U930zQ704dNGquWAqxEfMJJz/6z2zQ\n" +
        "hVYfPeii0Suxqmjz3AVzAoGAH04xASCN3quBrOGkXXhjWcuwW4t87xSZzh6sZNPm\n" +
        "aUX8kgyvUxT2C34v+uXcTkdPgLdsH2GQwv/YFHupCPyCJMBbiFGtQcUvAvzu8FfF\n" +
        "B+btC0/RQTnwWDLHDuM9gQ9tXtGbto0VWgpNSVFzEaRvU7BceL//v6pihe6xmbtt\n" +
        "inECgYEAs4N+p+kxs/tNJAvxOqsBHbPUldEsmXht+uagxaUArJP/GLznN+734Ryw\n" +
        "L/8wfTF3JOudCCV0lYoqYj/0YNj3QeKtUL8I9Myg3ZEV9r312hlpY1dHybqbAWvs\n" +
        "9bjGylKvu7UzCcQNuSGPFnpPOR28jSppYVSC5npgo6Yup0kNpv8=\n" +
        "-----END RSA PRIVATE KEY-----\n";
    
        let publicKey = 
        "-----BEGIN PUBLIC KEY-----\n" +
        "MIIBITANBgkqhkiG9w0BAQEFAAOCAQ4AMIIBCQKCAQB52EypOvlrF6ou80w6qDsh\n" +
        "C7+8/8mEAzVJXk1NTZamn9WRu9QV4P34/4pdZ6y2CplHmpUeUpjvXE/I1P8tr+NA\n" +
        "R7zE/7XugQBJTWreN69he3jephMTsBaK2WVvuR/El6JWricvrFqXb9LeeZZ//R87\n" +
        "vlCxj1OjkRQJ01zahUqtutuhcvZkWtT7L2bjlGlziGQ+TkZeUqqLEcf8n0/jivcZ\n" +
        "WjVspxcTRaa5FZ+4jPnNhQrx+lgXjgp7nj1SCCx0arNGQUp1jlfblqEeEtYjJNoS\n" +
        "FgXJuWhNEMa63Uk0WoHIRJ8L3ZaAUDolHDF8oOFSXHk0fc9LR1cUCiTMB8hU3q1v\n" +
        "AgMBAAE=\n" +
        "-----END PUBLIC KEY-----";
    
    

        let keyPair = RSAKeyPair.fromKeys('pkcs8', publicKey, privateKey);

        let info = { type: 'person', name: 'Eric', last: 'Hobsbawm'};

        let id = Identity.create(info, keyPair);

        let packed = id.toHashedLiterals();

        let id2 = HashedObject.fromHashedLiterals(packed);

        expect(id.equals(id2)).toBeTruthy();

        let text = 'a short string';

        let signature = keyPair.sign(text);

        expect(id.verify(text, signature)).toBeTruthy();

    });
});