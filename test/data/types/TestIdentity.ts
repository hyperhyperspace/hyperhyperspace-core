import { RSAKeyPair, Identity } from 'data/identity';


class TestIdentity {


    static privateKey = 
    "-----BEGIN PRIVATE KEY-----\n" +
    "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDcl6HjhLeboXhS\n" +
    "h+DZa1JhePf5wUYxLdFibd6L5biKpzjuPb1QiYKNWbIdNVuM16j0zzLwd06GFw7O\n" +
    "Dr/XVuQQFJedLzb2SLbLfDs6D2FIyLYsDFqYwXzsClUmXpzqq4V9kDtowuAl6YW8\n" +
    "WbJ6xTvfz39ieRN3r00etjdF87q2wT1mO6eFjER8KLU5G6GIRNtzCwZ32k9Gpq96\n" +
    "x/5BPrqRm4IvGzq3jGHmxAGeP+9/9LmeIboQmXM8vbCW5gmZPWsJbH0fXzioPk3G\n" +
    "6Pal11I4Xti342Kl5CKhDFd3LKw7WK0ZSHrcd5622oiXgQWFtXiw+YTYUe5O356E\n" +
    "EnTaU/FLAgMBAAECggEAMbbyw0X741VGusLox9dKH7GVoXIPkbHTyK0eRMUnDAiX\n" +
    "6gl8CxSSmaynWbHWyi0oZNP1lQAucEXuDj6AudVZXM5nRQOJDYRhvgZnirRAppil\n" +
    "hdPa7yZcMw45FoaoMrMpSJ0i5n9U6PZyL3q/oK+myNAI03aaDpUxekRyvI8re1gy\n" +
    "kwqYshYAjKDCdEhHveTB2e+TyoyM7K/Funim5pzZwKvWFU3VkO/Q2H9aCX4dnFQH\n" +
    "eywnCi7gISbddaJBzXPQEBrAomrequ0NyBRB0Btgde5mDYcW1CdGWwfDvMceo10w\n" +
    "14xbalrIa7TnIUi5UrCtU6cDB7jFTEv5bZKy8DUbAQKBgQDuJmCSJNTBUdEeP8ga\n" +
    "imh59lkl4cEthKIh5Y8XxTD2b1tga6O2Z6dAlsbkSfqDPxDzZJRodQkmW2RqmLaD\n" +
    "9IWSKfUoTbYyfF4i3AV8cvMiB6LbBi9F+cwltdOIg1/2k71iRy0PanPt8v9TY96X\n" +
    "S0iQOnHiFYqxGW0Lgwo4hVNaCwKBgQDtIFwcVWds7y5jngGdI7TMRwsk37htECzK\n" +
    "sV0RENb0ZUPLFOVjrdj3bo9JekLfioYut/JLOTiO4bZ6BCckljwi/OHpuA0vzrOK\n" +
    "rUnYNB5hdgyWSkdK9oRyC84G/vtGTYP+cPSUD2ySqt/oYZFmTNUcPyEnlXmJl3Ut\n" +
    "yl0NPc+NwQKBgQC/OBVmgyhJqXYtwazckrHc7A8cua4w7ER6zyYcQftUhIlsXEFx\n" +
    "nrzOwcIlX7lEVQk5RVNcpEyafdudM82pGld9yy7ME8nts6qqdtv41xueAV+kWczv\n" +
    "dOmUhfC5tjMBfBMerGPj8ufu8aRNwuzhslMra6IxlHZuSSojii5Uv8jzjQKBgAUl\n" +
    "JJqAx+O3NNx4ezR7p9qe2AEO0aOcLDyhqJFMOj3HTLdFVszY4tJLldRUUMsk6FBv\n" +
    "MVSsgyumfh0bpfXHRLrFnelCUxbsdzzVEbsdNmOK+i7woadgvfLzip7gPXeDCxAk\n" +
    "R0pHI2XzSzRxmYQMursIK6H+Pkrb/HDn6Sj2ZGCBAoGBAIfsGm1uWJjFMTIOEFjR\n" +
    "UdgKeDxRlxjUfSEAQaT/0puBPl8DPtzHtNPXppo0RjJudFplD0XeiUpe8iEpGmMm\n" +
    "M/UIriB8oyEBClTF0Wby+tVSy3Yo68Y+GN1EX/z/rT5V8Kr6Dsc9+zZPfdbyno8Z\n" +
    "J2/sabWdFpSVB4v+NDPn8tim\n" +
    "-----END PRIVATE KEY-----\n";
    
        static publicKey = 
    "-----BEGIN PUBLIC KEY-----\n" +
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3Jeh44S3m6F4Uofg2WtS\n" +
    "YXj3+cFGMS3RYm3ei+W4iqc47j29UImCjVmyHTVbjNeo9M8y8HdOhhcOzg6/11bk\n" +
    "EBSXnS829ki2y3w7Og9hSMi2LAxamMF87ApVJl6c6quFfZA7aMLgJemFvFmyesU7\n" +
    "389/YnkTd69NHrY3RfO6tsE9ZjunhYxEfCi1ORuhiETbcwsGd9pPRqavesf+QT66\n" +
    "kZuCLxs6t4xh5sQBnj/vf/S5niG6EJlzPL2wluYJmT1rCWx9H184qD5Nxuj2pddS\n" +
    "OF7Yt+NipeQioQxXdyysO1itGUh63HeettqIl4EFhbV4sPmE2FHuTt+ehBJ02lPx\n" +
    "SwIDAQAB\n" +
    "-----END PUBLIC KEY-----\n";

    static async getFirstTestIdentity() {

        let keyPair = await TestIdentity.getFistTestKeyPair();
        
        let info = { type: 'person', name: 'Eric', last: 'Hobsbawm'};

        let id = Identity.fromKeyPair(info, keyPair);

        return id;
    }

    static getFistTestKeyPair() {
        let keyPair = RSAKeyPair.fromKeys(TestIdentity.publicKey, TestIdentity.privateKey);

        return keyPair;
    }

}

export { TestIdentity };