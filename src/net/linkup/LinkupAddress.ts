class LinkupAddress {
    readonly serverURL : string;
    readonly linkupId  : string;

    constructor(serverURL: string, linkupId: string) {

        if (serverURL[serverURL.length-1] === '/') {
            serverURL = serverURL.substring(0, serverURL.length-1);
        }

        this.serverURL = serverURL;
        this.linkupId  = linkupId;
    }

    url() : string {
        return this.serverURL + '/' + this.linkupId;
    }

    static fromURL(url: string) {
        if (url[url.length-1] === '/') {
            url = url.substring(0, url.length-1);
        }

        let protoParts = url.split('://');

        let proto = '';

        if (protoParts.length > 1) {
            proto = protoParts.shift() as string + '://';
        }

        url = protoParts.join('://');

        let urlParts = url.split('/');
        let serverUrl = urlParts.shift() as string;
        //urlParts.push('');
        let linkupId = urlParts.join('/');

        return new LinkupAddress(proto + serverUrl, linkupId as string);
    }

}

export { LinkupAddress };